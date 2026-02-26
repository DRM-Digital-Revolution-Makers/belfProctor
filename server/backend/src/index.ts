import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";

import authRouter from "./routes/auth";
import clientsRouter from "./routes/clients";
import eventsRouter from "./routes/events";
import heartbeatRouter from "./routes/heartbeat";
import filesRouter from "./routes/files";
import policiesRouter from "./routes/policies";
import activityRouter from "./routes/activity";
import { requireAuth } from "./middleware/auth";
import bcrypt from "bcryptjs";
import { decryptAes256CbcPrefixedIv } from "./encryption";
import { getUser, saveUser, getClient } from "./store";

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

// Ensure upload directories
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, "screenshots"), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, "reports"), { recursive: true });

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
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter: 600 req/min (50+ clients). Env RATE_LIMIT_MAX overrides.
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "600", 10);
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.isFinite(RATE_LIMIT_MAX) ? RATE_LIMIT_MAX : 600,
});
app.use("/api/", limiter);

// Raw parsers: minimal buffers for ingestion
app.use(
  "/api/events",
  express.raw({ type: "application/octet-stream", limit: "64kb" }),
);
app.use(
  "/api/heartbeat",
  express.raw({ type: "application/octet-stream", limit: "16kb" }),
);
app.use(
  "/api/activity",
  express.raw({ type: "application/octet-stream", limit: "32kb" }),
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

// Command results (JSON, encrypted octet-stream)
app.post(
  "/api/commands/:id/json",
  express.raw({ type: "application/octet-stream", limit: "512kb" }),
  async (req, res) => {
    try {
      const commandId = req.params.id;
      const clientId = (req.headers["x-client-id"] as string) || "";
      if (!clientId)
        return res.status(400).json({ message: "X-Client-Id header required" });

      const client = await getClient(clientId);
      if (!client || !client.encryptionKey) {
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }

      const encrypted: Buffer = Buffer.isBuffer(req.body)
        ? (req.body as Buffer)
        : Buffer.from([]);
      const decryptedJson = decryptAes256CbcPrefixedIv(
        encrypted,
        client.encryptionKey,
      ).toString("utf-8");

      const dir = path.join(UPLOAD_DIR, "commands", clientId);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${commandId}_${Date.now()}.json`;
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, decryptedJson);

      res.json({ ok: true, path: filepath });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to ingest command result" });
    }
  },
);

// Admin: read latest command result by id (JSON)
app.get("/api/commands/:id/json", async (req, res) => {
  try {
    const commandId = req.params.id;
    const baseDir = path.join(UPLOAD_DIR, "commands");
    const clientDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : [];
    let latestPath = "";
    let latestMtime = 0;
    for (const c of clientDirs) {
      const dir = path.join(baseDir, c);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${commandId}_`) && f.endsWith(".json"));
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestPath = fp;
        }
      }
    }
    if (!latestPath)
      return res.status(404).json({ message: "Result not found" });
    const content = fs.readFileSync(latestPath, "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.send(content);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to read command result" });
  }
});

// Back-compat: read latest command result by id (JSON) on legacy path
app.get("/api/commands/:id/result", async (req, res) => {
  try {
    const commandId = req.params.id;
    const baseDir = path.join(UPLOAD_DIR, "commands");
    const clientDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : [];
    let latestPath = "";
    let latestMtime = 0;
    for (const c of clientDirs) {
      const dir = path.join(baseDir, c);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${commandId}_`) && f.endsWith(".json"));
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestPath = fp;
        }
      }
    }
    if (!latestPath)
      return res.status(404).json({ message: "Result not found" });
    const content = fs.readFileSync(latestPath, "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.send(content);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to read command result" });
  }
});

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

// Start HTTP server and attach WebSocket
const server = app.listen(PORT, HOST as any, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});

// WebSocket: no compression, 64KB max payload (flat memory for 20 clients)
const clients = new Map<string, WebSocket>();
const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 65536,
});
wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const rawId = url.searchParams.get("clientId") || "";
    const clientId = rawId.trim();
    if (!clientId) {
      socket.close();
      return;
    }
    clients.set(clientId, socket);
    socket.on("close", () => {
      if (clients.get(clientId) === socket) {
        clients.delete(clientId);
      }
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
    const socket = clients.get(String(clientId).trim());
    if (!socket || socket.readyState !== 1)
      return res.status(404).json({ message: "client not connected" });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cmd = { id, type, payload: payload ?? {} };
    socket.send(JSON.stringify(cmd));
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to send command" });
  }
});

// Admin convenience: request directory listing from client
app.post("/api/commands/list", requireAuth, async (req, res) => {
  try {
    const {
      clientId,
      basePath,
      pattern = "*",
      recursive = false,
      maxEntries = 1000,
      includeDirs = true,
    } = req.body as any;
    if (!clientId || !basePath)
      return res
        .status(400)
        .json({ message: "clientId and basePath required" });
    const socket = clients.get(String(clientId).trim());
    if (!socket || socket.readyState !== 1)
      return res.status(404).json({ message: "client not connected" });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = { basePath, pattern, recursive, maxEntries, includeDirs };
    const cmd = { id, type: "list", payload };
    socket.send(JSON.stringify(cmd));
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to request directory listing" });
  }
});

// Admin convenience: request a file from client
app.post("/api/commands/file", requireAuth, async (req, res) => {
  try {
    const { clientId, path: filePath } = req.body as any;
    if (!clientId || !filePath)
      return res.status(400).json({ message: "clientId and path required" });
    const socket = clients.get(String(clientId).trim());
    if (!socket || socket.readyState !== 1)
      return res.status(404).json({ message: "client not connected" });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = { path: filePath };
    const cmd = { id, type: "file", payload };
    socket.send(JSON.stringify(cmd));
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to request file from client" });
  }
});

// Admin convenience: request a folder zip from client
app.post("/api/commands/folder", requireAuth, async (req, res) => {
  try {
    const { clientId, path: folderPath } = req.body as any;
    if (!clientId || !folderPath)
      return res.status(400).json({ message: "clientId and path required" });
    const socket = clients.get(String(clientId).trim());
    if (!socket || socket.readyState !== 1)
      return res.status(404).json({ message: "client not connected" });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = { path: folderPath };
    const cmd = { id, type: "folder", payload };
    socket.send(JSON.stringify(cmd));
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to request folder from client" });
  }
});
