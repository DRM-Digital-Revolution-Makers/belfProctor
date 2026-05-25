import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { getClient, getClients } from "../store";
import { resolveUploadDir } from "../runtimePaths";
import {
  isClientConnected,
  requestClientUpdate,
  listPendingUpdates,
} from "../wsHub";
import { prisma } from "../prisma";

const router = Router();

const UPLOAD_DIR = resolveUploadDir();
const UPDATES_ROOT = path.join(UPLOAD_DIR, "updates");
const INDEX_FILE = path.join(UPDATES_ROOT, "index.json");
const DEPLOYMENTS_FILE = path.join(UPDATES_ROOT, "deployments.json");

const MAX_UPDATE_SIZE = parseInt(
  process.env.MAX_UPDATE_BYTES || String(500 * 1024 * 1024), // 500 MB cap
  10,
);

// Multer: stream upload to temp, then move into versioned dir.
const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmp = path.join(UPLOAD_DIR, "tmp_updates");
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
    cb(null, tmp);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}_${file.originalname}`);
  },
});
const upload = multer({
  storage: tempStorage,
  limits: { fileSize: MAX_UPDATE_SIZE },
});

interface UpdateMeta {
  version: string;
  filename: string; // always BelfProctor.exe
  sha256: string;
  size: number;
  uploadedAt: string;
  notes?: string;
}

interface DeploymentRecord {
  id: string;
  version: string;
  clientId: string;
  sentAt: string;
  delivered: boolean; // queued vs sent immediately
  lastStatus?: string;
  lastStatusAt?: string;
  lastDetail?: string;
}

function toDeploymentStatus(status: string):
  | "queued"
  | "sent"
  | "downloading"
  | "verifying"
  | "installing"
  | "restarted"
  | "confirmed"
  | "rolled_back"
  | "failed"
  | "already_up_to_date" {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("already")) return "already_up_to_date";
  if (normalized.includes("queued")) return "queued";
  if (normalized.includes("sent")) return "sent";
  if (normalized.includes("download")) return "downloading";
  if (normalized.includes("verify")) return "verifying";
  if (normalized.includes("install")) return "installing";
  if (normalized.includes("restart")) return "restarted";
  if (normalized.includes("confirm") || normalized === "ok" || normalized === "success") {
    return "confirmed";
  }
  if (normalized.includes("rollback") || normalized.includes("rolled")) return "rolled_back";
  if (normalized.includes("sha") || normalized.includes("mismatch")) return "failed";
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  return "sent";
}

async function ensurePrismaClient(clientId: string): Promise<void> {
  if (!prisma) return;
  const fileClient = await getClient(clientId);
  await prisma.client.upsert({
    where: { id: clientId },
    update: fileClient?.encryptionKey ? { encryptionKey: fileClient.encryptionKey } : {},
    create: { id: clientId, encryptionKey: fileClient?.encryptionKey || "" },
  });
}

async function ensureRoot(): Promise<void> {
  if (!fs.existsSync(UPDATES_ROOT)) {
    await fsPromises.mkdir(UPDATES_ROOT, { recursive: true });
  }
}

async function readIndex(): Promise<UpdateMeta[]> {
  await ensureRoot();
  if (!fs.existsSync(INDEX_FILE)) return [];
  try {
    const raw = await fsPromises.readFile(INDEX_FILE, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: UpdateMeta[]): Promise<void> {
  await ensureRoot();
  const tmp = INDEX_FILE + ".tmp";
  await fsPromises.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fsPromises.rename(tmp, INDEX_FILE);
}

async function readDeployments(): Promise<DeploymentRecord[]> {
  await ensureRoot();
  if (!fs.existsSync(DEPLOYMENTS_FILE)) return [];
  try {
    const raw = await fsPromises.readFile(DEPLOYMENTS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeDeployments(items: DeploymentRecord[]): Promise<void> {
  await ensureRoot();
  const tmp = DEPLOYMENTS_FILE + ".tmp";
  await fsPromises.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fsPromises.rename(tmp, DEPLOYMENTS_FILE);
}

export async function appendDeploymentStatus(
  commandId: string,
  status: string,
  detail?: string,
): Promise<void> {
  if (!commandId) return;
  const items = await readDeployments();
  const idx = items.findIndex((d) => d.id === commandId);
  if (idx < 0) return;
  items[idx].lastStatus = status;
  items[idx].lastStatusAt = new Date().toISOString();
  if (detail !== undefined) items[idx].lastDetail = detail;
  await writeDeployments(items);
  if (prisma) {
    await prisma.updateDeployment
      .update({
        where: { id: commandId },
        data: {
          status: toDeploymentStatus(status),
          detail: detail !== undefined ? detail : status,
        },
      })
      .catch(() => null);
  }
}

function isValidVersion(v: string): boolean {
  return /^\d+\.\d+\.\d+(\.\d+)?$/.test(v);
}

function streamSha256(filePath: string): Promise<{ sha: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let size = 0;
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha: hash.digest("hex"), size }));
  });
}

// ============ Endpoints ============

// POST /api/updates  (admin)
// multipart: file=<BelfProctor.exe>, version=1.0.1, notes=optional
router.post(
  "/",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const version = String(req.body?.version || "").trim();
      const notes = String(req.body?.notes || "").trim();
      if (!isValidVersion(version)) {
        if (tempPath) try { await fsPromises.unlink(tempPath); } catch {}
        return res.status(400).json({ message: "invalid version (expected x.y.z)" });
      }
      if (!tempPath) {
        return res.status(400).json({ message: "file required" });
      }

      const versionDir = path.join(UPDATES_ROOT, version);
      if (fs.existsSync(versionDir)) {
        try { await fsPromises.unlink(tempPath); } catch {}
        return res.status(409).json({ message: "version already exists" });
      }

      await ensureRoot();
      await fsPromises.mkdir(versionDir, { recursive: true });
      const finalPath = path.join(versionDir, "BelfProctor.exe");
      // Move (rename) — same filesystem in our setup, so it's atomic.
      await fsPromises.rename(tempPath, finalPath);

      const { sha, size } = await streamSha256(finalPath);

      const meta: UpdateMeta = {
        version,
        filename: "BelfProctor.exe",
        sha256: sha,
        size,
        uploadedAt: new Date().toISOString(),
        notes: notes || undefined,
      };
      await fsPromises.writeFile(
        path.join(versionDir, "meta.json"),
        JSON.stringify(meta, null, 2),
        "utf-8",
      );

      const idx = await readIndex();
      // Replace any existing entry (shouldn't happen with the 409 above, but be defensive)
      const next = idx.filter((m) => m.version !== version);
      next.push(meta);
      // Sort: newest version semantically last? Simpler — by uploadedAt desc.
      next.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      await writeIndex(next);
      if (prisma) {
        await prisma.agentVersion.upsert({
          where: { version },
          update: {
            filename: "BelfProctor.exe",
            sha256: sha,
            size: BigInt(size),
            notes: notes || undefined,
          },
          create: {
            version,
            filename: "BelfProctor.exe",
            sha256: sha,
            size: BigInt(size),
            notes: notes || undefined,
          },
        });
      }

      return res.json({ ok: true, update: meta });
    } catch (e) {
      console.error("[updates] upload failed", e);
      if (tempPath) try { await fsPromises.unlink(tempPath); } catch {}
      return res.status(500).json({ message: "upload failed" });
    }
  },
);

// GET /api/updates  (admin)  → list versions
router.get("/", requireAuth, async (_req, res) => {
  const idx = await readIndex();
  return res.json({ data: idx, total: idx.length });
});

// DELETE /api/updates/:version  (admin)
router.delete("/:version", requireAuth, async (req, res) => {
  const version = String(req.params.version || "").trim();
  if (!isValidVersion(version)) {
    return res.status(400).json({ message: "invalid version" });
  }
  const dir = path.join(UPDATES_ROOT, version);
  if (!fs.existsSync(dir)) {
    return res.status(404).json({ message: "not found" });
  }
  try {
    await fsPromises.rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error("[updates] delete dir failed", e);
  }
  const idx = await readIndex();
  await writeIndex(idx.filter((m) => m.version !== version));
  if (prisma) {
    await prisma.agentVersion.delete({ where: { version } }).catch(() => null);
  }
  return res.json({ ok: true });
});

// GET /api/updates/deployments  (admin) → history of deploy commands
router.get("/deployments", requireAuth, async (_req, res) => {
  const items = await readDeployments();
  const pending = await listPendingUpdates();
  return res.json({ data: items, pending });
});

// POST /api/updates/:version/deploy  (admin)
// body: { clientIds: string[] | "all" }
router.post("/:version/deploy", requireAuth, async (req, res) => {
  const version = String(req.params.version || "").trim();
  if (!isValidVersion(version)) {
    return res.status(400).json({ message: "invalid version" });
  }
  const idx = await readIndex();
  const meta = idx.find((m) => m.version === version);
  if (!meta) {
    return res.status(404).json({ message: "version not found" });
  }

  let targetIds: string[] = [];
  const body = req.body || {};
  if (body.clientIds === "all") {
    const all = await getClients();
    targetIds = (all || []).map((c: any) => String(c.id)).filter(Boolean);
  } else if (Array.isArray(body.clientIds)) {
    targetIds = body.clientIds.map((s: any) => String(s).trim()).filter(Boolean);
  } else {
    return res.status(400).json({ message: "clientIds required" });
  }

  // The downloadUrl is computed per-client inside requestClientUpdate based on
  // the IP that client actually used to reach us via WS. This auto-detects
  // the correct address for each client, no env config needed.
  const adminLocalAddr =
    (req.socket as any)?.localAddress as string | undefined;

  const payload = {
    version: meta.version,
    sha256: meta.sha256,
  };

  if (prisma) {
    await prisma.agentVersion
      .upsert({
        where: { version: meta.version },
        update: {
          filename: meta.filename,
          sha256: meta.sha256,
          size: BigInt(meta.size),
          notes: meta.notes || undefined,
        },
        create: {
          version: meta.version,
          filename: meta.filename,
          sha256: meta.sha256,
          size: BigInt(meta.size),
          notes: meta.notes || undefined,
        },
      })
      .catch(() => null);
  }

  const deployments = await readDeployments();
  const results: Array<{
    clientId: string;
    sent: boolean;
    queued: boolean;
    commandId: string | null;
  }> = [];

  for (const clientId of targetIds) {
    try {
      const r = await requestClientUpdate(clientId, payload, adminLocalAddr);
      const baseUrl = await import("../wsHub").then((m) =>
        m.resolveClientDownloadBase(clientId, adminLocalAddr),
      );
      console.log(
        `[updates] deploy ${meta.version} → ${clientId} via ${baseUrl}/api/updates/${meta.version}/file`,
      );
      results.push({
        clientId,
        sent: r.sent,
        queued: r.queued,
        commandId: r.commandId,
      });
      if (r.commandId) {
        if (prisma) {
          await ensurePrismaClient(clientId);
          await prisma.updateDeployment
            .create({
              data: {
                id: r.commandId,
                version: meta.version,
                clientId,
                status: r.sent ? "sent" : "queued",
              },
            })
            .catch(() => null);
        }
        deployments.push({
          id: r.commandId,
          version: meta.version,
          clientId,
          sentAt: new Date().toISOString(),
          delivered: r.sent,
          lastStatus: r.sent ? "sent" : "queued_offline",
          lastStatusAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("[updates] deploy failed for", clientId, e);
      results.push({ clientId, sent: false, queued: false, commandId: null });
    }
  }

  // Keep history bounded (last 1000)
  const trimmed = deployments.slice(-1000);
  await writeDeployments(trimmed);

  return res.json({ ok: true, version, results });
});

// GET /api/updates/:version/file  (client)
// Auth: X-Client-Id header → must be a known client.
router.get("/:version/file", async (req, res) => {
  const version = String(req.params.version || "").trim();
  if (!isValidVersion(version)) {
    return res.status(400).json({ message: "invalid version" });
  }
  const clientId = String(req.headers["x-client-id"] || "").trim();
  if (!clientId) {
    return res.status(401).json({ message: "client id required" });
  }
  const client = await getClient(clientId);
  if (!client) {
    return res.status(403).json({ message: "unknown client" });
  }
  const exePath = path.join(UPDATES_ROOT, version, "BelfProctor.exe");
  if (!fs.existsSync(exePath)) {
    return res.status(404).json({ message: "not found" });
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="BelfProctor.exe"`,
  );
  return res.sendFile(exePath);
});

// GET /api/updates/connectivity  (admin)
// Quick check: which client ids are currently WS-connected
router.get("/connectivity", requireAuth, async (_req, res) => {
  const clients = await getClients();
  const out = (clients || []).map((c: any) => ({
    id: String(c.id),
    version: c.version || "",
    online: isClientConnected(String(c.id)),
  }));
  return res.json({ data: out });
});

export default router;
