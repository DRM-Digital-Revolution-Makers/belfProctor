import { Router } from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { getSenderClientId } from "../clientId";
import { getClient, saveClient } from "../store";
import { getKeysToTry } from "../keyring";
import { prisma } from "../prisma";
import { resolveUploadDir } from "../runtimePaths";
import { makeId } from "../services/id";
import { resolveProjectFromPath } from "../services/projectResolver";
import { classifyActivity } from "../services/rulesClassifier";
import { requireAuth } from "../middleware/auth";

const router = Router();

type WorkEnvelope = {
  eventId?: string;
  schemaVersion?: number;
  clientId?: string;
  timestampUtc?: string;
  eventType?: string;
  sourceVersion?: string;
  payload?: any;
};

const VALID_CONFIDENCE = new Set(["high", "medium", "low", "unknown"]);
const VALID_END_REASONS = new Set([
  "active",
  "switch",
  "app_closed",
  "timeout",
  "shutdown",
  "unknown",
]);

function toDate(value: unknown): Date {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toBigIntMs(value: unknown): bigint {
  return BigInt(Math.max(0, Math.round(Number(value || 0))));
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" | "unknown" {
  const normalized = String(value || "unknown").toLowerCase();
  return VALID_CONFIDENCE.has(normalized)
    ? (normalized as "high" | "medium" | "low" | "unknown")
    : "unknown";
}

function normalizeEndReason(
  value: unknown,
): "active" | "switch" | "app_closed" | "timeout" | "shutdown" | "unknown" {
  const normalized = String(value || "unknown").toLowerCase();
  return VALID_END_REASONS.has(normalized)
    ? (normalized as "active" | "switch" | "app_closed" | "timeout" | "shutdown" | "unknown")
    : "unknown";
}

async function readEncryptedPayload(req: any, clientId: string): Promise<{ payload: any; usedKey: string }> {
  if (req.is?.("application/json") && req.body && !Buffer.isBuffer(req.body)) {
    return { payload: req.body, usedKey: "" };
  }

  const client = await getClient(clientId);
  const keysToTry = getKeysToTry(client?.encryptionKey);
  const encrypted: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

  for (const key of keysToTry) {
    try {
      const json = decryptAes256CbcPrefixedIv(encrypted, key).toString("utf-8");
      return { payload: JSON.parse(json), usedKey: key };
    } catch {
      continue;
    }
  }

  throw new Error("Decryption failed");
}

async function getRootsAndAliases() {
  if (!prisma) return { roots: [], aliases: [] };
  const [roots, aliases] = await Promise.all([
    prisma.projectRoot.findMany({ where: { isActive: true } }),
    prisma.projectAlias.findMany(),
  ]);
  return { roots, aliases };
}

async function appendFallback(clientId: string, item: any): Promise<void> {
  const dir = path.join(resolveUploadDir(), "work_sessions");
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.appendFile(
    path.join(dir, `${clientId}.jsonl`),
    JSON.stringify({ ...item, _ingestedAt: new Date().toISOString() }) + "\n",
    "utf-8",
  );
}

async function markUnknownPath(input: {
  filePath?: string;
  clientId: string;
  processName?: string;
}): Promise<void> {
  if (!prisma || !input.filePath) return;
  const id = makeId("unknown_path");
  await prisma.unknownProjectPath.upsert({
    where: { path: input.filePath },
    update: {
      lastSeenAt: new Date(),
      seenCount: { increment: 1 },
      clientId: input.clientId,
      processName: input.processName || undefined,
    },
    create: {
      id,
      path: input.filePath,
      clientId: input.clientId,
      processName: input.processName || undefined,
    },
  });
}

async function ensurePrismaClient(clientId: string): Promise<void> {
  if (!prisma) return;
  const fileClient = await getClient(clientId);
  await prisma.client.upsert({
    where: { id: clientId },
    update: fileClient?.encryptionKey ? { encryptionKey: fileClient.encryptionKey } : {},
    create: {
      id: clientId,
      encryptionKey: fileClient?.encryptionKey || "",
    },
  });
}

async function ingestEnvelope(raw: WorkEnvelope, fallbackClientId: string): Promise<void> {
  const payload = raw.payload || raw;
  const clientId = String(raw.clientId || payload.clientId || fallbackClientId);
  const timestampUtc = toDate(raw.timestampUtc || payload.timestampUtc || payload.timestamp || Date.now());
  const sessionId = String(payload.sessionId || payload.id || makeId("work_session"));
  const eventId = String(raw.eventId || payload.eventId || makeId("work_event"));
  const processName = String(payload.processName || "");
  const windowTitle = payload.windowTitle ? String(payload.windowTitle) : undefined;
  const filePath = payload.filePath ? String(payload.filePath) : undefined;
  const { roots, aliases } = await getRootsAndAliases();
  const projectResolution = resolveProjectFromPath(filePath, roots, aliases);
  const projectName = payload.projectName || projectResolution.projectName || undefined;
  const folderPath = payload.folderPath || projectResolution.folderPath || undefined;
  const classification = classifyActivity({
    processName,
    windowTitle,
    filePath,
    projectName,
  });
  const confidence = normalizeConfidence(payload.confidence || classification.confidence);
  const eventType = String(raw.eventType || payload.eventType || "snapshot");
  const isEndEvent = eventType === "end";
  const endReason = normalizeEndReason(
    payload.endReason || (isEndEvent ? "unknown" : "active"),
  );

  await saveClient({ id: clientId, lastSeen: new Date() });

  if (!prisma) {
    await appendFallback(clientId, { raw, payload, projectName, folderPath, classification });
    return;
  }

  const existingEvent = await prisma.workSessionEvent.findUnique({
    where: { eventId },
    select: { eventId: true },
  });
  if (existingEvent) {
    return;
  }

  if (filePath && projectResolution.isExternal && !projectName) {
    await markUnknownPath({ filePath, clientId, processName });
  }

  await ensurePrismaClient(clientId);

  await prisma.workSession.upsert({
    where: { id: sessionId },
    update: {
      adapter: payload.adapter || "generic",
      processName: processName || "unknown",
      windowTitle,
      filePath,
      folderPath,
      projectName,
      category: classification.category,
      productivityLevel: classification.productivityLevel,
      confidence,
      openedMs: toBigIntMs(payload.openedMs),
      focusedMs: toBigIntMs(payload.focusedMs),
      activeFocusedMs: toBigIntMs(payload.activeFocusedMs),
      endedAt: payload.endedAt ? toDate(payload.endedAt) : isEndEvent ? timestampUtc : undefined,
      endReason,
      lastEventAt: timestampUtc,
      metadata: payload.metadata || undefined,
    },
    create: {
      id: sessionId,
      clientId,
      adapter: payload.adapter || "generic",
      processName: processName || "unknown",
      windowTitle,
      filePath,
      folderPath,
      projectName,
      category: classification.category,
      productivityLevel: classification.productivityLevel,
      confidence,
      openedMs: toBigIntMs(payload.openedMs),
      focusedMs: toBigIntMs(payload.focusedMs),
      activeFocusedMs: toBigIntMs(payload.activeFocusedMs),
      startedAt: payload.startedAt ? toDate(payload.startedAt) : timestampUtc,
      endedAt: payload.endedAt ? toDate(payload.endedAt) : isEndEvent ? timestampUtc : undefined,
      endReason,
      lastEventAt: timestampUtc,
      metadata: payload.metadata || undefined,
    },
  });

  await prisma.workSessionEvent.create({
    data: {
      eventId,
      schemaVersion: Number(raw.schemaVersion || 1),
      clientId,
      sessionId,
      eventType,
      timestampUtc,
      adapter: payload.adapter || undefined,
      processName: processName || undefined,
      windowTitle,
      filePath,
      folderPath,
      projectName,
      confidence,
      payload: {
        ...payload,
        classification,
      },
      sourceVersion: raw.sourceVersion || payload.sourceVersion || undefined,
    },
  }).catch((e: any) => {
    if (String(e?.code) === "P2002") return null;
    throw e;
  });
}

router.post("/events", async (req, res) => {
  try {
    const clientId = getSenderClientId(req);
    const { payload, usedKey } = await readEncryptedPayload(req, clientId);
    if (usedKey) {
      await saveClient({ id: clientId, encryptionKey: usedKey, lastSeen: new Date() });
    }

    const items = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      await ingestEnvelope(item, clientId);
    }
    res.json({ ok: true, count: items.length });
  } catch (e: any) {
    console.error("[work] ingest failed", e);
    res.status(String(e?.message || "").includes("Decrypt") ? 400 : 500).json({
      message: e?.message || "Failed to ingest work events",
    });
  }
});

router.get("/projects", requireAuth, async (req, res) => {
  if (!prisma) return res.json({ data: [], total: 0 });
  const from = toDate(req.query.from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const to = toDate(req.query.to || new Date().toISOString());
  const rows = await prisma.workSession.groupBy({
    by: ["projectName"],
    where: {
      startedAt: { gte: from, lte: to },
      projectName: { not: null },
    },
    _sum: { openedMs: true, focusedMs: true, activeFocusedMs: true },
    _count: { _all: true },
    orderBy: { _sum: { activeFocusedMs: "desc" } },
  });
  const data = rows.map((r: any) => ({
    projectName: r.projectName,
    openedMs: Number(r._sum.openedMs || 0),
    focusedMs: Number(r._sum.focusedMs || 0),
    activeFocusedMs: Number(r._sum.activeFocusedMs || 0),
    sessionsCount: r._count._all,
  }));
  res.json({ data, total: data.length });
});

router.get("/unknown", requireAuth, async (req, res) => {
  if (!prisma) return res.json({ data: [], total: 0 });
  const fromRaw = String(req.query.from || "").trim();
  const toRaw = String(req.query.to || "").trim();
  const where: any = { ignored: false, resolvedProjectName: null };
  if (fromRaw || toRaw) {
    where.lastSeenAt = {};
    if (fromRaw) where.lastSeenAt.gte = toDate(fromRaw);
    if (toRaw) where.lastSeenAt.lte = toDate(toRaw);
  }
  const data = await prisma.unknownProjectPath.findMany({
    where,
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  res.json({ data, total: data.length });
});

router.put("/unknown/:id/resolve", requireAuth, async (req, res) => {
  if (!prisma) return res.status(503).json({ message: "Prisma unavailable" });
  const id = String(req.params.id);
  const projectName = String(req.body?.projectName || "").trim();
  if (!projectName) return res.status(400).json({ message: "projectName required" });
  const updated = await prisma.unknownProjectPath.update({
    where: { id },
    data: { resolvedProjectName: projectName },
  });
  res.json(updated);
});

router.get("/project-roots", requireAuth, async (_req, res) => {
  if (!prisma) return res.json({ data: [], total: 0 });
  const data = await prisma.projectRoot.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ data, total: data.length });
});

router.post("/project-roots", requireAuth, async (req, res) => {
  if (!prisma) return res.status(503).json({ message: "Prisma unavailable" });
  const name = String(req.body?.name || "").trim();
  const rootPath = String(req.body?.path || "").trim();
  if (!name || !rootPath) return res.status(400).json({ message: "name and path required" });
  const created = await prisma.projectRoot.create({
    data: { id: makeId("project_root"), name, path: rootPath, isActive: req.body?.isActive !== false },
  });
  res.json(created);
});

router.delete("/project-roots/:id", requireAuth, async (req, res) => {
  if (!prisma) return res.status(503).json({ message: "Prisma unavailable" });
  await prisma.projectRoot.delete({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

router.get("/project-aliases", requireAuth, async (_req, res) => {
  if (!prisma) return res.json({ data: [], total: 0 });
  const data = await prisma.projectAlias.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ data, total: data.length });
});

router.post("/project-aliases", requireAuth, async (req, res) => {
  if (!prisma) return res.status(503).json({ message: "Prisma unavailable" });
  const alias = String(req.body?.alias || "").trim();
  const projectName = String(req.body?.projectName || "").trim();
  if (!alias || !projectName) return res.status(400).json({ message: "alias and projectName required" });
  const created = await prisma.projectAlias.create({
    data: { id: makeId("project_alias"), alias, projectName },
  });
  res.json(created);
});

router.delete("/project-aliases/:id", requireAuth, async (req, res) => {
  if (!prisma) return res.status(503).json({ message: "Prisma unavailable" });
  await prisma.projectAlias.delete({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

export default router;
