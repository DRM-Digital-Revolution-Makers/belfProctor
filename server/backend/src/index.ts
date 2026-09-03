import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { WebSocketServer, WebSocket } from "ws";
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
import { startHeartbeatGapDetector } from "./jobs/heartbeatGapDetector";
import { startGitHubReleasePoller } from "./jobs/githubReleasePoller";
import { requireAuth } from "./middleware/auth";
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
  sendCommandToClient,
  registerStreamSource,
  registerStreamViewer,
} from "./wsHub";
import { runRetentionOnce } from "./retention";
import { withLock } from "./locks";
import { initServerLogToStorage } from "./serverLog";
import { getPrimaryEncryptionKey } from "./keyring";
import { resolveUploadDir } from "./runtimePaths";

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const UPLOAD_DIR = resolveUploadDir();
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

void getPrimaryEncryptionKey();

if (!process.env.ENCRYPTION_KEY && !process.env.ENCRYPTION_KEYS) {
  console.warn(
    "[Config] ENCRYPTION_KEY is not set. Clients may fall back to the default key. Set ENCRYPTION_KEY for pilot/prod.",
  );
}
if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
  console.warn(
    "[Config] DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD are not set. No admin will be auto-created on boot.",
  );
}

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
  if (process.env.DISABLE_FILE_LOGS !== "1") {
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
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Client-Id",
    "X-Admin-Password",
    "Cache-Control",
    "Pragma",
    "X-Requested-With",
  ],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
// Skip morgan in prod to avoid per-request allocation (flat 50-70MB for 20 clients)
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("combined"));
}
app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Rate limiter: 10000 req/min (virtually unlimited for your scale). Env RATE_LIMIT_MAX overrides.
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "10000", 10);
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.isFinite(RATE_LIMIT_MAX) ? RATE_LIMIT_MAX : 10000,
  keyGenerator: (req: any) => {
    const cid = normalizeClientId(String(req?.headers?.["x-client-id"] || ""));
    if (cid) return `client:${cid}`;
    return `ip:${String(req.ip || "")}`;
  },
});
app.use("/api/", limiter);

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
    `${path.basename(filePath)}.tmp_${process.pid}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`,
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
  const fp = path.join(COMMAND_INDEX_DIR, `${commandId}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const content = await fsPromises.readFile(fp, "utf-8");
    const obj = JSON.parse(content);
    const p = String(obj?.latestPath || "").trim();
    return p || null;
  } catch {
    return null;
  }
}

async function writeCommandIndex(commandId: string, latestPath: string): Promise<void> {
  const fp = path.join(COMMAND_INDEX_DIR, `${commandId}.json`);
  await withLock(`file:${fp}`, async () => {
    await writeJsonFileAtomic(
      fp,
      JSON.stringify(
        { commandId, latestPath, updatedAt: new Date().toISOString() },
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
      const clientId = getSenderClientId(req);

      const client = await getClient(clientId);
      if (!client) {
        await saveClient({
          id: clientId,
          createdAt: new Date(),
          lastSeen: new Date(),
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

app.get("/api/commands/:id/json", commandResultHandler);
app.get("/api/commands/:id/result", commandResultHandler);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Seed default admin if not exists
async function ensureAdmin() {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await getUser(email);
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await saveUser({ email, passwordHash, role: "ADMIN" });
    console.log(`Created default admin: ${email}`);
  }
}

ensureAdmin().catch(console.error);

setTimeout(() => {
  (async () => {
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
        } catch {}
        try {
          await backfillTimesheetFromActivity(id, currMonth);
        } catch {}
      }
    } catch {}

    try {
      await runRetentionOnce();
    } catch {}

    setInterval(
      () => {
        runRetentionOnce().catch(() => {});
      },
      6 * 60 * 60 * 1000,
    );

    startHeartbeatGapDetector();
    startGitHubReleasePoller();
  })();
}, 30_000);

// Start HTTP server and attach WebSocket
const server = app.listen(PORT, HOST as any, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});

// WebSocket: no compression, 64KB max payload (flat memory for 20 clients)
const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 2 * 1024 * 1024,
});
wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname === "/ws/stream") {
      const streamClientId = String(url.searchParams.get("clientId") || "").trim();
      if (!streamClientId) {
        socket.close();
        return;
      }
      registerStreamSource(streamClientId, socket);
      return;
    }

    if (url.pathname.startsWith("/ws/admin/stream/")) {
      const token = String(url.searchParams.get("token") || "").trim();
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

    const rawId = url.searchParams.get("clientId") || "";
    const clientId = rawId.trim();
    if (!clientId) {
      socket.close();
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

// Admin endpoint to send command to a client via WebSocket
app.post("/api/commands/send", requireAuth, async (req, res) => {
  try {
    const { clientId, type, payload } = req.body as any;
    if (!clientId || !type)
      return res.status(400).json({ message: "clientId and type required" });
    const id = sendCommandToClient(clientId, type, payload ?? {});
    if (!id) return res.status(404).json({ message: "client not connected" });
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to send command" });
  }
});

// Admin convenience endpoints
const createCommandSender = (
  type: string,
  payloadFactory: (req: express.Request) => any,
) => {
  return async (req: express.Request, res: express.Response) => {
    try {
      const { clientId } = req.body as any;
      if (!clientId)
        return res.status(400).json({ message: "clientId required" });
      const payload = payloadFactory(req);
      const id = sendCommandToClient(clientId, type, payload);
      if (!id) return res.status(404).json({ message: "client not connected" });
      res.json({ ok: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: `Failed to request ${type}` });
    }
  };
};

app.post(
  "/api/commands/list",
  requireAuth,
  createCommandSender("list", (req) => {
    const {
      basePath,
      pattern = "*",
      recursive = false,
      maxEntries = 1000,
      includeDirs = true,
    } = req.body;
    return { basePath, pattern, recursive, maxEntries, includeDirs };
  }),
);

app.post(
  "/api/commands/file",
  requireAuth,
  createCommandSender("file", (req) => {
    return { path: req.body.path };
  }),
);

app.post(
  "/api/commands/folder",
  requireAuth,
  createCommandSender("folder", (req) => {
    return { path: req.body.path };
  }),
);
