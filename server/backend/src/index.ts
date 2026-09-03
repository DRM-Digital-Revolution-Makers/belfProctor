import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { verifyAgentWsSignature } from "./wsAuth";
import { getKeysToTry } from "./keyring";
import { IncomingMessage } from "http";

import authRouter from "./routes/auth";
import clientsRouter from "./routes/clients";
import eventsRouter from "./routes/events";
import heartbeatRouter from "./routes/heartbeat";
import filesRouter from "./routes/files";
import policiesRouter from "./routes/policies";
import activityRouter from "./routes/activity";
import logsRouter from "./routes/logs";
import updatesRouter, { appendDeploymentStatus } from "./routes/updates";
import workRouter from "./routes/work";
import pcSessionRouter from "./routes/pcSession";
import browserActivityRouter from "./routes/browserActivity";
import commandsRouter from "./routes/commands";
import { startHeartbeatGapDetector } from "./jobs/heartbeatGapDetector";
import { startTimeSync, getDebugState as getTimeDebugState, now as authoritativeNow } from "./serverTime";
import { extractAuthToken, requireAdmin, requireAuth } from "./middleware/auth";
import { jsonErrorHandler } from "./middleware/error";
import bcrypt from "bcryptjs";
import { decryptAes256CbcPrefixedIv } from "./encryption";
import {
  getUser,
  saveUser,
  getClient,
  saveClient,
  getClients,
  backfillTimesheetFromActivity,
} from "./store";
import { getSenderClientId, normalizeClientId } from "./clientId";
import {
  registerClientSocket,
  unregisterClientSocket,
  registerStreamSource,
  registerStreamViewer,
} from "./wsHub";
import { runRetentionOnce } from "./retention";
import { indexExistingReports } from "./services/reportStore";
import { withLock } from "./locks";
import { initServerLogToStorage } from "./serverLog";
import { config } from "./config";
import { connectWithRetry, disconnectPrisma, pingDatabase } from "./prisma";
import { getConnectedClientCount } from "./wsHub";
import { isSafeCommandId } from "./util/commandId";

const app = express();
if (config.isProduction) app.set("trust proxy", 1);
const PORT = config.port;
const HOST = config.host;
const UPLOAD_DIR = config.uploadDir;
const JWT_SECRET = config.jwtSecret;
// Config validation (secrets, DB url, retention, feature flags) runs on import
// of ./config and will refuse to boot in production on an insecure setup.

// Ensure upload directories
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error(
    `[Boot] Failed to create UPLOAD_DIR: ${UPLOAD_DIR}. Check permissions or set absolute UPLOAD_DIR.`,
  );
  console.error(e);
  process.exit(1);
}
try {
  if (config.fileLogsEnabled) {
    initServerLogToStorage(UPLOAD_DIR);
  }
} catch (e) {
  console.error("[Boot] Failed to init file logs, continuing with console logs.");
  console.error(e);
}
const screenshotsDir = path.join(UPLOAD_DIR, "screenshots");
if (!fs.existsSync(screenshotsDir))
  fs.mkdirSync(screenshotsDir, { recursive: true });
const reportsDir = path.join(UPLOAD_DIR, "reports");
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
const corsOptions: cors.CorsOptions = {
  origin: config.isProduction ? false : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Client-Id",
    "Cache-Control",
    "Pragma",
    "X-Requested-With",
  ],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
// Skip morgan in prod to avoid per-request allocation (flat 50-70MB for 20 clients)
if (!config.isProduction) {
  app.use(morgan("combined"));
}
// Global transport-level ceiling. Authentication has an additional strict limiter.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimitMax,
  keyGenerator: (req: any) =>
    `ip:${String(req.ip || req.socket?.remoteAddress || "unknown")}`,
});
app.use("/api/", limiter);

// Rate limiting must run before parsers allocate attacker-controlled bodies.
// Large binary artifacts use their dedicated streaming multipart endpoints.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Raw parsers: generous buffers for ingestion
app.use(
  "/api/events",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
);
app.use(
  "/api/heartbeat",
  express.raw({ type: "application/octet-stream", limit: "1mb" }),
);
app.use(
  "/api/activity",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
);
app.use(
  "/api/work/events",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
);
app.use(
  "/api/logs",
  express.raw({ type: "application/octet-stream", limit: "1mb" }),
);
app.use(
  "/api/pc-session",
  express.raw({ type: "application/octet-stream", limit: "256kb" }),
);
app.use(
  "/api/browser-activity",
  express.raw({ type: "application/octet-stream", limit: "5mb" }),
);
// Use raw parser only for the specific octet-stream endpoint to avoid breaking JSON admin endpoints under /api/commands

// Routes
app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/heartbeat", heartbeatRouter);
app.use("/api", filesRouter); // screenshots & reports
app.use("/api/policies", policiesRouter);
app.use("/api/activity", activityRouter);
app.use("/api/logs", logsRouter);
app.use("/api/updates", updatesRouter);
app.use("/api/work", workRouter);
app.use("/api/pc-session", pcSessionRouter);
app.use("/api/browser-activity", browserActivityRouter);
app.use("/api/commands", commandsRouter);

// Lazy load: ~200KB saved until first request (flat memory for 20 clients)
let _legacyTimesheet: any = null;
app.get("/api/legacy-timesheet", requireAuth, async (_req, res) => {
  if (!_legacyTimesheet) {
    const m = await import("./data/legacyTimesheet");
    _legacyTimesheet = m.legacyTimesheet;
  }
  res.json(_legacyTimesheet);
});

// Serve frontend build
const LOCAL_PUBLIC = path.join(process.cwd(), "public");
const FRONT_DIST = path.join(process.cwd(), "..", "frontend", "dist");

let staticDir = "";
if (fs.existsSync(FRONT_DIST)) {
  staticDir = FRONT_DIST;
} else if (fs.existsSync(LOCAL_PUBLIC)) {
  staticDir = LOCAL_PUBLIC;
}

if (staticDir) {
  app.use(express.static(staticDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  // SPA fallback for client-side routing, avoid intercepting /api/*
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Helper to find latest command result
async function findLatestCommandResult(
  commandId: string,
): Promise<string | null> {
  if (!isSafeCommandId(commandId)) return null;
  const baseDir = path.join(UPLOAD_DIR, "commands");
  if (!fs.existsSync(baseDir)) return null;

  const clientDirs = await fsPromises.readdir(baseDir);
  let latestPath = "";
  let latestMtime = 0;

  for (const c of clientDirs) {
    const dir = path.join(baseDir, c);
    const statDir = await fsPromises.stat(dir);
    if (!statDir.isDirectory()) continue;

    const files = (await fsPromises.readdir(dir)).filter(
      (f) => f.startsWith(`${commandId}_`) && f.endsWith(".json"),
    );

    for (const f of files) {
      const fp = path.join(dir, f);
      const stat = await fsPromises.stat(fp);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestPath = fp;
      }
    }
  }
  return latestPath || null;
}

const COMMAND_INDEX_DIR = path.join(UPLOAD_DIR, "command_index");
async function writeJsonFileAtomic(filePath: string, json: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.tmp_${process.pid}_${randomUUID()}`,
  );
  await fsPromises.writeFile(tmp, json, "utf-8");
  try {
    await fsPromises.rename(tmp, filePath);
  } catch {
    try {
      await fsPromises.unlink(filePath);
    } catch {}
    await fsPromises.rename(tmp, filePath);
  } finally {
    try {
      await fsPromises.unlink(tmp);
    } catch {}
  }
}

async function readCommandIndex(commandId: string): Promise<string | null> {
  if (!isSafeCommandId(commandId)) return null;
  const fp = path.join(COMMAND_INDEX_DIR, `${commandId}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const content = await fsPromises.readFile(fp, "utf-8");
    const obj = JSON.parse(content);
    const p = String(obj?.latestPath || "").trim();
    if (!p) return null;
    const commandsRoot = path.resolve(UPLOAD_DIR, "commands") + path.sep;
    const resolved = path.resolve(p);
    return resolved.startsWith(commandsRoot) ? resolved : null;
  } catch {
    return null;
  }
}

async function writeCommandIndex(commandId: string, latestPath: string): Promise<void> {
  if (!isSafeCommandId(commandId)) throw new Error("Invalid command id");
  const fp = path.join(COMMAND_INDEX_DIR, `${commandId}.json`);
  await withLock(`file:${fp}`, async () => {
    await writeJsonFileAtomic(
      fp,
      JSON.stringify(
        { commandId, latestPath, updatedAt: authoritativeNow().toISOString() },
        null,
        2,
      ),
    );
  });
}

// Command results (JSON, encrypted octet-stream)
app.post(
  "/api/commands/:id/json",
  express.raw({ type: "application/octet-stream", limit: "512kb" }),
  async (req, res) => {
    try {
      const commandId = req.params.id;
      if (!isSafeCommandId(commandId)) {
        return res.status(400).json({ message: "Invalid command id" });
      }
      const clientId = getSenderClientId(req);

      const client = await getClient(clientId);
      if (!client) {
        await saveClient({
          id: clientId,
          createdAt: authoritativeNow(),
          lastSeen: authoritativeNow(),
        });
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }
      if (!client.encryptionKey) {
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }

      const encrypted: Buffer = Buffer.isBuffer(req.body)
        ? (req.body as Buffer)
        : Buffer.from([]);
      if (encrypted.length < 17) {
        return res.status(400).json({ message: "Empty payload" });
      }
      let decryptedJson = "";
      try {
        decryptedJson = decryptAes256CbcPrefixedIv(
          encrypted,
          client.encryptionKey,
        ).toString("utf-8");
      } catch {
        return res.status(400).json({ message: "Decryption failed" });
      }

      const dir = path.join(UPLOAD_DIR, "commands", clientId);
      if (!fs.existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });

      const filename = `${commandId}_${Date.now()}.json`;
      const filepath = path.join(dir, filename);
      await withLock(`file:${filepath}`, async () => {
        await fsPromises.writeFile(filepath, decryptedJson);
      });
      await writeCommandIndex(commandId, filepath);

      // If this looks like an update-status payload, record into deployment history
      try {
        const parsed = JSON.parse(decryptedJson);
        if (parsed && typeof parsed === "object" && "status" in parsed) {
          await appendDeploymentStatus(
            commandId,
            String(parsed.status || ""),
            parsed.detail !== undefined ? String(parsed.detail) : undefined,
          );
        } else if (parsed && parsed.ok === false && parsed.error) {
          await appendDeploymentStatus(
            commandId,
            `error:${String(parsed.error)}`,
            parsed.detail !== undefined ? String(parsed.detail) : undefined,
          );
        }
      } catch {
        /* not JSON or not an update result — ignore */
      }

      res.json({ ok: true, path: filepath });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to ingest command result" });
    }
  },
);

// Unified endpoint for command results
const commandResultHandler = async (
  req: express.Request,
  res: express.Response,
) => {
  try {
    const commandId = req.params.id;
    if (!isSafeCommandId(commandId)) {
      return res.status(400).json({ message: "Invalid command id" });
    }
    const indexed = await readCommandIndex(commandId);
    let latestPath = indexed && fs.existsSync(indexed) ? indexed : null;
    if (!latestPath) {
      latestPath = await findLatestCommandResult(commandId);
      if (latestPath) {
        await writeCommandIndex(commandId, latestPath);
      }
    }

    if (!latestPath)
      return res.status(404).json({ message: "Result not found" });

    let content = "";
    await withLock(`file:${latestPath}`, async () => {
      content = await fsPromises.readFile(latestPath, "utf-8");
    });
    res.setHeader("Content-Type", "application/json");
    res.send(content);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to read command result" });
  }
};

app.get("/api/commands/:id/json", requireAdmin, commandResultHandler);
app.get("/api/commands/:id/result", requireAdmin, commandResultHandler);

/**
 * Health probe for external monitors (uptime checks, load balancers, the ops
 * team). Reports the database, free disk on the storage volume, process memory
 * and the number of connected agents. Returns 503 when a hard dependency
 * (the database) is unreachable so monitors can alert instead of guessing.
 */
async function healthHandler(_req: express.Request, res: express.Response) {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  // Database (hard dependency)
  try {
    const HEALTH_DB_TIMEOUT_MS = 2000;
    // Attach a no-op catch to the ping so that, if it loses the race to the
    // timeout, its eventual rejection does not surface as an unhandled rejection.
    const ping = pingDatabase();
    ping.catch(() => undefined);
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("timeout")),
        HEALTH_DB_TIMEOUT_MS,
      );
    });
    const latencyMs = await Promise.race([ping, timeout]).finally(() =>
      clearTimeout(timer),
    );
    checks.database = { ok: true, latencyMs };
  } catch (e) {
    healthy = false;
    checks.database = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Free disk on the storage volume (best-effort; statfs may be unavailable)
  try {
    const statfs = (fsPromises as unknown as {
      statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
    }).statfs;
    if (statfs) {
      const s = await statfs(UPLOAD_DIR);
      const freeBytes = s.bsize * s.bavail;
      const totalBytes = s.bsize * s.blocks;
      checks.disk = {
        ok: true,
        freeBytes,
        freePercent:
          totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 100) : null,
      };
    }
  } catch (e) {
    checks.disk = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const mem = process.memoryUsage();
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    time: authoritativeNow().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    connectedClients: getConnectedClientCount(),
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    },
    checks,
  });
}

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.get("/api/time", (_req, res) => res.json(getTimeDebugState()));

// Seed default admin if not exists
async function ensureAdmin() {
  if (!config.admin) return;
  const { email, password } = config.admin;
  const existing = await getUser(email);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await saveUser({ email, passwordHash, role: "ADMIN" });
    console.log(`Created default admin: ${email}`);
  }
}

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKGROUND_JOBS_START_DELAY_MS = 30_000;

/**
 * Backfill timesheets for the current and previous month, run an initial
 * retention sweep, then schedule periodic retention and the heartbeat-gap
 * detector. Deferred after boot so the first wave of client traffic is not
 * competing with these maintenance scans.
 */
function scheduleBackgroundJobs(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, "0");
        const currMonth = `${y}-${m}`;
        const prev = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
        );
        const py = prev.getUTCFullYear();
        const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
        const prevMonth = `${py}-${pm}`;

        const clients = await getClients();
        for (const c of clients) {
          const id = String(c?.id || "").trim();
          if (!id) continue;
          try {
            await backfillTimesheetFromActivity(id, prevMonth);
          } catch (e) {
            console.warn(`[Backfill] ${id} ${prevMonth} failed:`, e);
          }
          try {
            await backfillTimesheetFromActivity(id, currMonth);
          } catch (e) {
            console.warn(`[Backfill] ${id} ${currMonth} failed:`, e);
          }
        }
      } catch (e) {
        console.warn("[Backfill] sweep failed:", e);
      }

      // Index any report files that predate DB-backed reports so they appear
      // in the admin UI and are subject to retention.
      try {
        const indexed = await indexExistingReports(UPLOAD_DIR);
        if (indexed > 0) {
          console.log(`[Reports] Backfilled ${indexed} report file(s) into the DB.`);
        }
      } catch (e) {
        console.error("[Reports] Backfill failed:", e);
      }

      try {
        await runRetentionOnce();
      } catch (e) {
        console.error("[Retention] initial run failed:", e);
      }

      setInterval(() => {
        runRetentionOnce().catch((e) =>
          console.error("[Retention] scheduled run failed:", e),
        );
      }, RETENTION_INTERVAL_MS);

      startHeartbeatGapDetector();
    })();
  }, BACKGROUND_JOBS_START_DELAY_MS);
}

/** Attach the WebSocket server (command channel + screen streaming). */
function attachWebSocketServer(httpServer: import("http").Server): WebSocketServer {
  // WebSocket: no compression, 2MB max payload (flat memory for 20 clients)
  const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: false,
    maxPayload: 2 * 1024 * 1024,
  });
  wss.on("connection", async (socket: WebSocket, req: IncomingMessage) => {
    try {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname === "/ws/stream") {
      const streamClientId = String(url.searchParams.get("clientId") || "").trim();
      const client = streamClientId ? await getClient(streamClientId) : null;
      const authenticated = verifyAgentWsSignature({
        clientId: streamClientId,
        timestamp: String(url.searchParams.get("ts") || ""),
        nonce: String(url.searchParams.get("nonce") || ""),
        signature: String(url.searchParams.get("sig") || ""),
        secrets: getKeysToTry(client?.encryptionKey),
      });
      if (!authenticated) {
        socket.close(1008, "Unauthorized");
        return;
      }
      registerStreamSource(streamClientId, socket);
      return;
    }

    if (url.pathname.startsWith("/ws/admin/stream/")) {
      // Browser WebSockets carry the same-origin HttpOnly session cookie.
      // URL tokens are forbidden because proxy logs/history can disclose them.
      const token = extractAuthToken(req as any);
      let actor = "";
      try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        actor = String(payload?.email || payload?.id || "");
      } catch {
        socket.close();
        return;
      }
      const streamClientId = decodeURIComponent(
        url.pathname.replace(/^\/ws\/admin\/stream\//, ""),
      ).trim();
      if (!streamClientId) {
        socket.close();
        return;
      }
      registerStreamViewer(streamClientId, socket, actor);
      return;
    }

    if (url.pathname !== "/ws") {
      socket.close(1008, "Unsupported WebSocket path");
      return;
    }
    const rawId = url.searchParams.get("clientId") || "";
    const clientId = rawId.trim();
    const client = clientId ? await getClient(clientId) : null;
    const authenticated = verifyAgentWsSignature({
      clientId,
      timestamp: String(url.searchParams.get("ts") || ""),
      nonce: String(url.searchParams.get("nonce") || ""),
      signature: String(url.searchParams.get("sig") || ""),
      secrets: getKeysToTry(client?.encryptionKey),
    });
    if (!authenticated) {
      socket.close(1008, "Unauthorized");
      return;
    }
    // The IP this client used to reach the server — used to build
    // downloadUrl for push-updates (auto-detected per client).
    const localAddr = (req.socket as any)?.localAddress as string | undefined;
    registerClientSocket(clientId, socket, localAddr);
    socket.on("close", () => {
      unregisterClientSocket(clientId, socket);
    });
  } catch {
    socket.close();
  }
  });
  return wss;
}

// Express 4 does not natively forward rejected async route promises. The
// express-async-errors patch above routes them here so a transient DB/filesystem
// failure produces a bounded JSON 500 response instead of an unhandled
// rejection that can destabilize the process.
app.use(jsonErrorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────

const SHUTDOWN_FORCE_EXIT_MS = 10_000;

function registerGracefulShutdown(
  httpServer: import("http").Server,
  wss: WebSocketServer,
): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal} received, closing gracefully...`);

    // Safety net: if a connection refuses to drain, force exit rather than hang.
    const forceTimer = setTimeout(() => {
      console.error("[Shutdown] Graceful close timed out, forcing exit.");
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceTimer.unref();

    wss.close();
    httpServer.close(() => {
      void (async () => {
        await disconnectPrisma();
        clearTimeout(forceTimer);
        console.log("[Shutdown] Closed cleanly.");
        process.exit(0);
      })();
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function bootstrap(): Promise<void> {
  // 1. The database is a hard dependency — every route needs it. Retry to ride
  //    out a Postgres that is still starting; exit (so the service/PM2 restarts
  //    us) only after the configured attempts, instead of serving 500s forever.
  try {
    await connectWithRetry();
  } catch (e) {
    console.error(
      "[Boot] Database unavailable:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }

  // 2. Seed the admin account now that the DB is reachable.
  try {
    await ensureAdmin();
  } catch (e) {
    console.error("[Boot] ensureAdmin failed:", e);
  }

  // 3. Authoritative time sync — every ingest stamps data with it, so warm it
  //    before the first request lands.
  startTimeSync();

  // 4. Accept traffic and attach the WebSocket server.
  const httpServer = app.listen(PORT, HOST as unknown as string, () => {
    console.log(
      `Backend listening on http://${HOST}:${PORT} (env=${config.nodeEnv})`,
    );
  });
  const wss = attachWebSocketServer(httpServer);

  // 5. Deferred maintenance jobs (backfill, retention, gap detector).
  scheduleBackgroundJobs();

  // 6. Clean shutdown on signals.
  registerGracefulShutdown(httpServer, wss);
}

if (require.main === module) {
  void bootstrap().catch((e) => {
    console.error("[Boot] Fatal startup error:", e);
    process.exit(1);
  });
}

export { app };
