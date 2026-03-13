import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import type { WebSocket } from "ws";
import { resolveUploadDir } from "./runtimePaths";

const sockets = new Map<string, WebSocket>();

const UPLOAD_DIR = resolveUploadDir();
const PENDING_UNINSTALL_DIR = path.join(UPLOAD_DIR, "pending_uninstall");

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function ensurePendingDir(): Promise<void> {
  if (!fs.existsSync(PENDING_UNINSTALL_DIR)) {
    await fsPromises.mkdir(PENDING_UNINSTALL_DIR, { recursive: true });
  }
}

function pendingUninstallPath(clientId: string): string {
  return path.join(PENDING_UNINSTALL_DIR, `${clientId}.json`);
}

async function hasPendingUninstall(clientId: string): Promise<boolean> {
  const fp = pendingUninstallPath(clientId);
  return fs.existsSync(fp);
}

async function clearPendingUninstall(clientId: string): Promise<void> {
  const fp = pendingUninstallPath(clientId);
  if (fs.existsSync(fp)) {
    await fsPromises.unlink(fp);
  }
}

export async function consumePendingUninstall(clientId: string): Promise<{
  id: string;
  payload: any;
} | null> {
  await ensurePendingDir();
  const fp = pendingUninstallPath(clientId);
  if (!fs.existsSync(fp)) return null;
  try {
    const content = await fsPromises.readFile(fp, "utf-8");
    const rec = JSON.parse(content);
    await clearPendingUninstall(clientId);
    return { id: String(rec?.id || ""), payload: rec?.payload ?? {} };
  } catch {
    try {
      await clearPendingUninstall(clientId);
    } catch {}
    return null;
  }
}

export async function requestClientUninstall(
  clientId: string,
  payload: any = {},
): Promise<{ queued: boolean; sent: boolean; commandId: string | null }> {
  const id = makeId();
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

  const sent = sendCommandToClient(clientId, "uninstall", { ...payload, id });
  if (sent) {
    await clearPendingUninstall(clientId);
    return { queued: true, sent: true, commandId: id };
  }
  return { queued: true, sent: false, commandId: id };
}

export function registerClientSocket(
  clientId: string,
  socket: WebSocket,
): void {
  const prev = sockets.get(clientId);
  if (prev && prev !== socket) {
    try {
      prev.close();
    } catch {}
  }
  sockets.set(clientId, socket);
  (async () => {
    if (await hasPendingUninstall(clientId)) {
      try {
        const content = await fsPromises.readFile(
          pendingUninstallPath(clientId),
          "utf-8",
        );
        const rec = JSON.parse(content);
        const cmd = {
          id: rec?.id || makeId(),
          type: "uninstall",
          payload: rec?.payload ?? {},
        };
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(cmd));
        }
      } finally {
        try {
          await clearPendingUninstall(clientId);
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

export function sendCommandToClient(
  clientId: string,
  type: string,
  payload: any = {},
): string | null {
  const socket = sockets.get(String(clientId).trim());
  if (!socket || socket.readyState !== 1) return null;
  const id = makeId();
  const cmd = { id, type, payload: payload ?? {} };
  socket.send(JSON.stringify(cmd));
  return id;
}
