import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import type { WebSocket } from "ws";
import { resolveUploadDir } from "./runtimePaths";

const sockets = new Map<string, WebSocket>();
// IP-адрес сервера, по которому каждый клиент успешно достучался через WS.
// Используется для построения downloadUrl при push-обновлениях — каждый
// клиент получает URL с тем IP сервера, который у него работает.
const serverAddrByClient = new Map<string, string>();

const UPLOAD_DIR = resolveUploadDir();
const PENDING_UNINSTALL_DIR = path.join(UPLOAD_DIR, "pending_uninstall");
const PENDING_UPDATE_DIR = path.join(UPLOAD_DIR, "pending_update");
const SERVER_PORT = parseInt(process.env.PORT || "8080", 10);
const LIVE_VIEW_MAX_STREAMS = parseInt(process.env.LIVE_VIEW_MAX_STREAMS || "10", 10);

const streamSources = new Map<string, WebSocket>();
const streamViewers = new Map<string, Set<WebSocket>>();

function cleanIp(addr: string | undefined | null): string {
  if (!addr) return "";
  return String(addr).replace(/^::ffff:/, "").trim();
}

function isLoopback(addr: string): boolean {
  return (
    !addr ||
    addr === "127.0.0.1" ||
    addr === "localhost" ||
    addr === "::1" ||
    addr.startsWith("127.")
  );
}

/** Returns the server URL that this specific client successfully reached
 * us at via WebSocket. Null if no WS history. */
export function getServerAddrForClient(clientId: string): string | null {
  const ip = serverAddrByClient.get(clientId);
  if (!ip) return null;
  return `http://${ip}:${SERVER_PORT}`;
}

/** Build a URL that the given client can use to download something from us.
 * Strategy:
 *   1. The IP this client used to reach us via WS (most reliable).
 *   2. PUBLIC_BASE_URL env (optional override).
 *   3. The IP the admin's HTTP request came in on (req.socket.localAddress) —
 *      works if admin & client are on the same LAN segment.
 *   4. First non-loopback IPv4 from OS network interfaces. */
export function resolveClientDownloadBase(
  clientId: string,
  adminLocalAddr?: string,
): string {
  // 1. Per-client WS address — auto-detected
  const wsAddr = serverAddrByClient.get(clientId);
  if (wsAddr && !isLoopback(wsAddr)) {
    return `http://${wsAddr}:${SERVER_PORT}`;
  }

  // 2. Env override
  const envBase = process.env.PUBLIC_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  // 3. Admin's request landed on this server IP
  const adminIp = cleanIp(adminLocalAddr);
  if (adminIp && !isLoopback(adminIp)) {
    return `http://${adminIp}:${SERVER_PORT}`;
  }
  if (adminIp && isLoopback(adminIp)) {
    return `http://127.0.0.1:${SERVER_PORT}`;
  }

  // 4. Pick first non-loopback IPv4 from OS interfaces
  const os = require("os");
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === "IPv4" && !ni.internal && ni.address) {
        return `http://${ni.address}:${SERVER_PORT}`;
      }
    }
  }
  return `http://127.0.0.1:${SERVER_PORT}`;
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function appendStreamAudit(input: {
  clientId: string;
  action: string;
  actor?: string;
  detail?: string;
}): Promise<void> {
  try {
    const dir = path.join(UPLOAD_DIR, "live_view_audit");
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.appendFile(
      path.join(dir, "audit.jsonl"),
      JSON.stringify({ ...input, timestamp: new Date().toISOString() }) + "\n",
      "utf-8",
    );
  } catch {}
}

function activeViewerClientCount(): number {
  let count = 0;
  for (const viewers of streamViewers.values()) {
    if (viewers.size > 0) count += 1;
  }
  return count;
}

function getViewers(clientId: string): Set<WebSocket> {
  let viewers = streamViewers.get(clientId);
  if (!viewers) {
    viewers = new Set<WebSocket>();
    streamViewers.set(clientId, viewers);
  }
  return viewers;
}

export function registerStreamSource(clientId: string, socket: WebSocket): void {
  const id = String(clientId || "").trim();
  const prev = streamSources.get(id);
  if (prev && prev !== socket) {
    try {
      prev.close();
    } catch {}
  }
  streamSources.set(id, socket);

  socket.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const viewers = streamViewers.get(id);
    if (!viewers || viewers.size === 0) return;
    for (const viewer of viewers) {
      if (viewer.readyState === 1) {
        viewer.send(data, { binary: true });
      }
    }
  });

  socket.on("close", () => {
    if (streamSources.get(id) === socket) {
      streamSources.delete(id);
    }
    const viewers = streamViewers.get(id);
    if (viewers) {
      for (const viewer of viewers) {
        if (viewer.readyState === 1) {
          viewer.send(JSON.stringify({ type: "stream.stopped", clientId: id }));
        }
      }
    }
  });
}

export function registerStreamViewer(
  clientId: string,
  socket: WebSocket,
  actor?: string,
): void {
  const id = String(clientId || "").trim();
  const alreadyTracked = streamViewers.has(id) && (streamViewers.get(id)?.size || 0) > 0;
  if (!alreadyTracked && activeViewerClientCount() >= LIVE_VIEW_MAX_STREAMS) {
    socket.send(JSON.stringify({ type: "stream.error", message: "Live View limit reached" }));
    socket.close();
    return;
  }

  const viewers = getViewers(id);
  viewers.add(socket);
  appendStreamAudit({ clientId: id, action: "viewer_connected", actor }).catch(() => {});

  if (!alreadyTracked) {
    const commandId = sendCommandToClient(id, "stream.start", {
      width: 1920,
      fps: 12,
      quality: 80,
    });
    appendStreamAudit({
      clientId: id,
      action: "stream_start_requested",
      actor,
      detail: commandId || "client_offline",
    }).catch(() => {});
    if (!commandId && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "stream.error", message: "Client is not connected" }));
    }
  }

  socket.on("close", () => {
    viewers.delete(socket);
    appendStreamAudit({ clientId: id, action: "viewer_disconnected", actor }).catch(() => {});
    if (viewers.size === 0) {
      streamViewers.delete(id);
      sendCommandToClient(id, "stream.stop", {});
      appendStreamAudit({ clientId: id, action: "stream_stop_requested", actor }).catch(() => {});
    }
  });
}

async function ensurePendingDir(): Promise<void> {
  if (!fs.existsSync(PENDING_UNINSTALL_DIR)) {
    await fsPromises.mkdir(PENDING_UNINSTALL_DIR, { recursive: true });
  }
}

function pendingUninstallPath(clientId: string): string {
  return path.join(PENDING_UNINSTALL_DIR, `${clientId}.json`);
}

async function clearPendingUninstall(clientId: string): Promise<void> {
  const fp = pendingUninstallPath(clientId);
  if (fs.existsSync(fp)) {
    await fsPromises.unlink(fp);
  }
}

async function persistPendingUninstall(
  clientId: string,
  id: string,
  payload: any,
): Promise<void> {
  await ensurePendingDir();
  await fsPromises.writeFile(
    pendingUninstallPath(clientId),
    JSON.stringify({
      id,
      clientId,
      payload,
      createdAt: new Date().toISOString(),
    }),
    "utf-8",
  );
}

export async function consumePendingUninstall(clientId: string): Promise<{
  id: string;
  payload: any;
} | null> {
  await ensurePendingDir();
  const fp = pendingUninstallPath(clientId);
  // Atomically CLAIM the record by renaming it. rename() is atomic, so when two
  // consumers race (e.g. a heartbeat and a WebSocket reconnect of the same
  // client) only one rename succeeds; the loser gets ENOENT and returns null.
  // This guarantees the uninstall command is delivered exactly once [B-M5].
  const claimed = `${fp}.claim_${process.pid}_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
  try {
    await fsPromises.rename(fp, claimed);
  } catch {
    return null; // not present, or already claimed by a concurrent consumer
  }
  try {
    const content = await fsPromises.readFile(claimed, "utf-8");
    const rec = JSON.parse(content);
    return { id: String(rec?.id || ""), payload: rec?.payload ?? {} };
  } catch {
    return null;
  } finally {
    await fsPromises.unlink(claimed).catch(() => undefined);
  }
}

/** Re-queue an uninstall that was claimed but could not be delivered. */
export async function requeuePendingUninstall(
  clientId: string,
  id: string,
  payload: any,
): Promise<void> {
  await persistPendingUninstall(clientId, id, payload);
}

export async function requestClientUninstall(
  clientId: string,
  payload: any = {},
): Promise<{ queued: boolean; sent: boolean; commandId: string | null }> {
  const id = makeId();
  await persistPendingUninstall(clientId, id, payload);

  const sent = sendCommandToClient(clientId, "uninstall", { ...payload, id });
  if (sent) {
    await clearPendingUninstall(clientId);
    return { queued: true, sent: true, commandId: id };
  }
  return { queued: true, sent: false, commandId: id };
}

// ============ Pending updates (offline clients) ============
async function ensurePendingUpdateDir(): Promise<void> {
  if (!fs.existsSync(PENDING_UPDATE_DIR)) {
    await fsPromises.mkdir(PENDING_UPDATE_DIR, { recursive: true });
  }
}

function pendingUpdatePath(clientId: string): string {
  return path.join(PENDING_UPDATE_DIR, `${clientId}.json`);
}

async function hasPendingUpdate(clientId: string): Promise<boolean> {
  return fs.existsSync(pendingUpdatePath(clientId));
}

async function clearPendingUpdate(clientId: string): Promise<void> {
  const fp = pendingUpdatePath(clientId);
  if (fs.existsSync(fp)) {
    await fsPromises.unlink(fp);
  }
}

/**
 * Queue / send an update command.
 * The `downloadUrl` is computed at send time from the client's current WS
 * connection IP — NOT baked into the queue. This way, when an offline client
 * eventually reconnects (possibly via a different network path), we still
 * generate a working URL for them.
 */
export async function requestClientUpdate(
  clientId: string,
  payload: { version: string; sha256: string } & Record<string, any>,
  adminLocalAddr?: string,
): Promise<{ queued: boolean; sent: boolean; commandId: string | null }> {
  const id = makeId();
  await ensurePendingUpdateDir();
  // Persist only stable bits (version + sha256). URL recomputed at send.
  await fsPromises.writeFile(
    pendingUpdatePath(clientId),
    JSON.stringify({
      id,
      clientId,
      payload: { version: payload.version, sha256: payload.sha256 },
      createdAt: new Date().toISOString(),
    }),
    "utf-8",
  );

  const baseUrl = resolveClientDownloadBase(clientId, adminLocalAddr);
  const downloadUrl =
    `${baseUrl}/api/updates/${encodeURIComponent(payload.version)}/file`;

  const sent = sendCommandToClient(clientId, "update", {
    ...payload,
    downloadUrl,
    id,
  });
  if (sent) {
    await clearPendingUpdate(clientId);
    return { queued: true, sent: true, commandId: id };
  }
  return { queued: true, sent: false, commandId: id };
}

export async function listPendingUpdates(): Promise<
  Array<{ clientId: string; payload: any; createdAt: string; id: string }>
> {
  await ensurePendingUpdateDir();
  const result: Array<{
    clientId: string;
    payload: any;
    createdAt: string;
    id: string;
  }> = [];
  try {
    const files = await fsPromises.readdir(PENDING_UPDATE_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const content = await fsPromises.readFile(
          path.join(PENDING_UPDATE_DIR, f),
          "utf-8",
        );
        const rec = JSON.parse(content);
        result.push({
          clientId: rec?.clientId || f.replace(/\.json$/, ""),
          payload: rec?.payload ?? {},
          createdAt: rec?.createdAt || "",
          id: rec?.id || "",
        });
      } catch {}
    }
  } catch {}
  return result;
}

export function registerClientSocket(
  clientId: string,
  socket: WebSocket,
  serverAddr?: string,
): void {
  const prev = sockets.get(clientId);
  if (prev && prev !== socket) {
    try {
      prev.close();
    } catch {}
  }
  sockets.set(clientId, socket);
  const cleaned = cleanIp(serverAddr);
  if (cleaned && !isLoopback(cleaned)) {
    serverAddrByClient.set(clientId, cleaned);
  }
  (async () => {
    // Claim the uninstall atomically so the heartbeat path can't deliver the
    // same command concurrently [B-M5]. If we fail to push it (socket already
    // gone), re-queue so a later heartbeat/reconnect retries.
    const uninstall = await consumePendingUninstall(clientId);
    if (uninstall && uninstall.id) {
      let delivered = false;
      if (socket.readyState === 1) {
        try {
          socket.send(
            JSON.stringify({
              id: uninstall.id,
              type: "uninstall",
              payload: uninstall.payload ?? {},
            }),
          );
          delivered = true;
        } catch {
          delivered = false;
        }
      }
      if (!delivered) {
        await requeuePendingUninstall(
          clientId,
          uninstall.id,
          uninstall.payload,
        ).catch(() => undefined);
      }
    }

    if (await hasPendingUpdate(clientId)) {
      try {
        const content = await fsPromises.readFile(
          pendingUpdatePath(clientId),
          "utf-8",
        );
        const rec = JSON.parse(content);
        const basePayload = rec?.payload ?? {};
        // Recompute downloadUrl now that the client is connected — use the
        // IP that just worked for them.
        const baseUrl = resolveClientDownloadBase(clientId);
        const downloadUrl = basePayload.version
          ? `${baseUrl}/api/updates/${encodeURIComponent(basePayload.version)}/file`
          : undefined;
        const cmd = {
          id: rec?.id || makeId(),
          type: "update",
          payload: { ...basePayload, downloadUrl },
        };
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(cmd));
        }
      } finally {
        try {
          await clearPendingUpdate(clientId);
        } catch {}
      }
    }
  })();
}

export function unregisterClientSocket(
  clientId: string,
  socket: WebSocket,
): void {
  if (sockets.get(clientId) === socket) {
    sockets.delete(clientId);
  }
}

export function isClientConnected(clientId: string): boolean {
  const socket = sockets.get(clientId);
  return !!socket && socket.readyState === 1;
}

/** Number of clients with a currently OPEN command-channel WebSocket. */
export function getConnectedClientCount(): number {
  let count = 0;
  for (const socket of sockets.values()) {
    if (socket.readyState === 1) count += 1;
  }
  return count;
}

export function sendCommandToClient(
  clientId: string,
  type: string,
  payload: any = {},
): string | null {
  const socket = sockets.get(String(clientId).trim());
  if (!socket || socket.readyState !== 1) return null;
  // Use payload.id if caller provided one (so deployment tracking and client
  // responses share the same command id). Otherwise mint a fresh one.
  const id =
    payload && typeof payload === "object" && payload.id
      ? String(payload.id)
      : makeId();
  const cmd = { id, type, payload: payload ?? {} };
  socket.send(JSON.stringify(cmd));
  return id;
}
