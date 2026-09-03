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
import {
  fetchLatestGitHubRelease,
  readGitHubSyncState,
  syncGitHubRelease,
  verifyGitHubWebhookSignature,
} from "../services/githubReleaseSync";

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

type UpdateQueueJobStatus = "queued" | "running" | "done" | "failed";

interface UpdateQueueJob {
  id: string;
  type: "github_latest" | "github_release" | "deploy_version";
  status: UpdateQueueJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: unknown;
  release?: any;
  version?: string;
  clientIds?: string[] | "all";
  adminLocalAddr?: string;
}

export type PublicUpdateQueueJob = Omit<UpdateQueueJob, "release">;

const updateQueue: UpdateQueueJob[] = [];
const updateQueueHistory: UpdateQueueJob[] = [];
let updateQueueRunning = false;

function envFlag(name: string, fallback = false): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeJobId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueUpdateJob(input: Omit<UpdateQueueJob, "id" | "status" | "createdAt">): UpdateQueueJob {
  const maxQueued = envInt("UPDATE_QUEUE_MAX_PENDING", 20);
  if (updateQueue.length >= maxQueued) {
    throw new Error("update queue is full");
  }

  const job: UpdateQueueJob = {
    ...input,
    id: makeJobId(input.type),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  updateQueue.push(job);
  runUpdateQueueSoon();
  return job;
}

function publicJob(job: UpdateQueueJob): PublicUpdateQueueJob {
  const { release, ...rest } = job;
  return rest;
}

export function enqueueGitHubLatestSyncJob(
  adminLocalAddr?: string,
): PublicUpdateQueueJob {
  const job = enqueueUpdateJob({ type: "github_latest", adminLocalAddr });
  return publicJob(job);
}

function getUpdateQueueState() {
  return {
    running: updateQueueRunning,
    queued: updateQueue.map(publicJob),
    recent: updateQueueHistory.slice(-20).map(publicJob),
  };
}

function runUpdateQueueSoon(): void {
  if (updateQueueRunning) return;
  setImmediate(() => {
    void runUpdateQueue();
  });
}

async function runUpdateQueue(): Promise<void> {
  if (updateQueueRunning) return;
  updateQueueRunning = true;
  try {
    while (updateQueue.length > 0) {
      const job = updateQueue.shift()!;
      job.status = "running";
      job.startedAt = new Date().toISOString();
      try {
        if (job.type === "deploy_version") {
          if (!job.version || !job.clientIds) throw new Error("deploy job missing version/clientIds");
          job.result = await deployUpdateVersion(job.version, job.clientIds, job.adminLocalAddr);
        } else {
          const release =
            job.type === "github_latest" ? await fetchLatestGitHubRelease() : job.release;
          const sync = await syncGitHubRelease(release);
          let deployment: Awaited<ReturnType<typeof deployUpdateVersion>> | undefined;
          if (
            sync.clientUpdate &&
            !sync.clientUpdate.alreadyStaged &&
            envFlag("GITHUB_RELEASE_AUTO_DEPLOY_CLIENT")
          ) {
            deployment = await deployUpdateVersion(
              sync.clientUpdate.version,
              "all",
              job.adminLocalAddr,
            );
          }
          job.result = { sync, deployment };
        }
        job.status = "done";
      } catch (e) {
        job.status = "failed";
        job.error = (e as Error)?.message || "job failed";
        console.error("[updates:queue] job failed", job.id, e);
      } finally {
        job.finishedAt = new Date().toISOString();
        updateQueueHistory.push(job);
        if (updateQueueHistory.length > 100) updateQueueHistory.splice(0, updateQueueHistory.length - 100);
      }
    }
  } finally {
    updateQueueRunning = false;
    if (updateQueue.length > 0) runUpdateQueueSoon();
  }
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
  const existing = await getClient(clientId);
  await prisma.client.upsert({
    where: { id: clientId },
    update: existing?.encryptionKey ? { encryptionKey: existing.encryptionKey } : {},
    create: { id: clientId, encryptionKey: existing?.encryptionKey || "" },
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

export async function deployUpdateVersion(
  version: string,
  clientIds: string[] | "all",
  adminLocalAddr?: string,
): Promise<{
  version: string;
  results: Array<{
    clientId: string;
    sent: boolean;
    queued: boolean;
    commandId: string | null;
  }>;
}> {
  if (!isValidVersion(version)) {
    throw new Error("invalid version");
  }
  const idx = await readIndex();
  const meta = idx.find((m) => m.version === version);
  if (!meta) {
    throw new Error("version not found");
  }

  let targetIds: string[] = [];
  if (clientIds === "all") {
    const all = await getClients();
    targetIds = (all || []).map((c: any) => String(c.id)).filter(Boolean);
  } else {
    targetIds = clientIds.map((s: any) => String(s).trim()).filter(Boolean);
  }

  const payload = {
    version: meta.version,
    sha256: meta.sha256,
  };

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

  const deployments = await readDeployments();
  const batchSize = envInt("CLIENT_UPDATE_DEPLOY_BATCH_SIZE", 10);
  const batchDelayMs = envInt("CLIENT_UPDATE_DEPLOY_BATCH_DELAY_MS", 30_000);
  const results: Array<{
    clientId: string;
    sent: boolean;
    queued: boolean;
    commandId: string | null;
  }> = [];

  for (let i = 0; i < targetIds.length; i++) {
    const clientId = targetIds[i];
    try {
      const r = await requestClientUpdate(clientId, payload, adminLocalAddr);
      const baseUrl = await import("../wsHub").then((m) =>
        m.resolveClientDownloadBase(clientId, adminLocalAddr),
      );
      console.log(
        `[updates] deploy ${meta.version} -> ${clientId} via ${baseUrl}/api/updates/${meta.version}/file`,
      );
      results.push({
        clientId,
        sent: r.sent,
        queued: r.queued,
        commandId: r.commandId,
      });
      if (r.commandId) {
        deployments.push({
          id: r.commandId,
          version: meta.version,
          clientId,
          sentAt: new Date().toISOString(),
          delivered: r.sent,
          lastStatus: r.sent ? "sent" : "queued_offline",
          lastStatusAt: new Date().toISOString(),
        });
        try {
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
        } catch (prismaErr) {
          console.warn(
            "[updates] prisma mirror failed (file record kept):",
            (prismaErr as Error)?.message || prismaErr,
          );
        }
      }
    } catch (e) {
      console.error("[updates] deploy failed for", clientId, e);
      results.push({ clientId, sent: false, queued: false, commandId: null });
    }

    const isBatchBoundary = (i + 1) % batchSize === 0;
    const hasMore = i + 1 < targetIds.length;
    if (isBatchBoundary && hasMore) {
      await writeDeployments(deployments.slice(-1000));
      console.log(
        `[updates] deploy ${meta.version}: throttling ${batchDelayMs}ms after ${i + 1}/${targetIds.length} clients`,
      );
      await sleep(batchDelayMs);
    }
  }

  await writeDeployments(deployments.slice(-1000));
  return { version, results };
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
      try {
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
      } catch (prismaErr) {
        console.warn(
          "[updates] prisma agentVersion mirror failed (file record kept):",
          (prismaErr as Error)?.message || prismaErr,
        );
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
  await prisma.agentVersion.delete({ where: { version } }).catch(() => null);
  return res.json({ ok: true });
});

// GET /api/updates/deployments  (admin) → history of deploy commands
router.get("/deployments", requireAuth, async (_req, res) => {
  const items = await readDeployments();
  const pending = await listPendingUpdates();
  return res.json({ data: items, pending });
});

// GET /api/updates/github/status (admin)
router.get("/github/status", requireAuth, async (_req, res) => {
  const state = await readGitHubSyncState();
  return res.json({
    ok: true,
    configured: {
      repository: Boolean(
        process.env.GITHUB_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY,
      ),
      webhookSecret: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
      autoDeployClient: envFlag("GITHUB_RELEASE_AUTO_DEPLOY_CLIENT"),
      pollEnabled: envFlag("GITHUB_RELEASE_POLL_ENABLED"),
      pollIntervalHours: envInt("GITHUB_RELEASE_POLL_INTERVAL_HOURS", 24),
    },
    state,
    queue: getUpdateQueueState(),
  });
});

// POST /api/updates/github/sync (admin)
// Fetches the latest GitHub Release and stages matching client/server assets.
router.post("/github/sync", requireAuth, async (req, res) => {
  try {
    const adminLocalAddr = (req.socket as any)?.localAddress as string | undefined;
    const job = enqueueGitHubLatestSyncJob(adminLocalAddr);
    return res.status(202).json({ ok: true, queued: true, job });
  } catch (e) {
    console.error("[updates:github] manual sync enqueue failed", e);
    return res.status(503).json({ message: (e as Error)?.message || "sync enqueue failed" });
  }
});

// POST /api/updates/github/webhook
// GitHub release webhook. Requires GITHUB_WEBHOOK_SECRET and signature header.
router.post("/github/webhook", async (req, res) => {
  try {
    const event = String(req.headers["x-github-event"] || "");
    if (event !== "release") {
      return res.json({ ok: true, ignored: event || "unknown_event" });
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = String(req.headers["x-hub-signature-256"] || "");
    if (!rawBody || !verifyGitHubWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ message: "invalid github webhook signature" });
    }

    const action = String(req.body?.action || "");
    if (!["published", "released"].includes(action)) {
      return res.json({ ok: true, ignored: action || "unknown_action" });
    }

    const release = req.body?.release;
    if (!release) {
      return res.status(400).json({ message: "release payload required" });
    }

    const adminLocalAddr = (req.socket as any)?.localAddress as string | undefined;
    const job = enqueueUpdateJob({
      type: "github_release",
      release,
      adminLocalAddr,
    });

    return res.status(202).json({ ok: true, queued: true, job: publicJob(job) });
  } catch (e) {
    console.error("[updates:github] webhook enqueue failed", e);
    return res.status(503).json({ message: (e as Error)?.message || "webhook enqueue failed" });
  }
});

// POST /api/updates/:version/deploy  (admin)
// body: { clientIds: string[] | "all" }
router.post("/:version/deploy", requireAuth, async (req, res) => {
  const version = String(req.params.version || "").trim();
  if (!isValidVersion(version)) {
    return res.status(400).json({ message: "invalid version" });
  }

  const body = req.body || {};
  const targetIds =
    body.clientIds === "all"
      ? "all"
      : Array.isArray(body.clientIds)
        ? body.clientIds.map((s: any) => String(s).trim()).filter(Boolean)
        : null;
  if (!targetIds) {
    return res.status(400).json({ message: "clientIds required" });
  }

  const adminLocalAddr =
    (req.socket as any)?.localAddress as string | undefined;
  try {
    const job = enqueueUpdateJob({
      type: "deploy_version",
      version,
      clientIds: targetIds,
      adminLocalAddr,
    });
    return res.status(202).json({ ok: true, queued: true, job: publicJob(job) });
  } catch (e) {
    const msg = (e as Error)?.message || "deploy enqueue failed";
    const status = msg.includes("queue is full") ? 503 : 500;
    return res.status(status).json({ message: msg });
  }
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
