import { Router } from "express";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { getClient, saveClient } from "../store";
import { getSenderClientId } from "../clientId";
import { requireAuth } from "../middleware/auth";
import { withLock } from "../locks";
import { getKeysToTry } from "../keyring";
import { resolveUploadDir } from "../runtimePaths";
import { config } from "../config";

const router = Router();

import { tashkentDayKey } from "../tz";
import { now as authoritativeNow, reconcile as reconcileTime } from "../serverTime";

const UPLOAD_DIR = resolveUploadDir();
const CLIENT_LOG_DIR = path.join(UPLOAD_DIR, "logs", "clients");
const SERVER_LOG_DIR = path.join(UPLOAD_DIR, "logs", "server");

// Group client logs into Tashkent calendar days so "2026-06-11.log" matches
// what the operator would call "11 июня" on their wall clock.
function dayKey(d: Date): string {
  return tashkentDayKey(d);
}

async function ensureDir(p: string): Promise<void> {
  await fsPromises.mkdir(p, { recursive: true });
}

router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const clientId = getSenderClientId(req);
    const client = await getClient(clientId);

    const keysToTry = getKeysToTry(client?.encryptionKey);

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);
    if (encrypted.length < 17) {
      return res.status(400).json({ message: "Empty payload" });
    }

    let decryptedJson = "";
    let usedKey = "";
    for (const key of keysToTry) {
      try {
        decryptedJson = decryptAes256CbcPrefixedIv(encrypted, key).toString(
          "utf-8",
        );
        JSON.parse(decryptedJson);
        usedKey = key;
        break;
      } catch {
        continue;
      }
    }

    const now = authoritativeNow();
    if (!usedKey) {
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(decryptedJson);
    const text = String(payload?.text || "");
    const fileName = String(payload?.fileName || payload?.file || "client.log");
    const level = String(payload?.level || "INFO").toUpperCase();
    const source = String(payload?.source || "client");
    const tsRaw = payload?.timestamp || payload?.time || payload?.Timestamp;
    const tsParsed = tsRaw ? new Date(tsRaw) : null;
    const when = reconcileTime(tsParsed && !isNaN(tsParsed.getTime()) ? tsParsed : null);

    const clientDay = dayKey(when);
    const dir = path.join(CLIENT_LOG_DIR, clientId);
    await ensureDir(dir);
    const fp = path.join(dir, `${clientDay}.log`);

    const lines = text.split(/\r?\n/);
    const prefix = `[${when.toISOString()}] [${level}] [${source}] [${fileName}] `;
    const out = lines
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
      .map((l) => prefix + l)
      .join("\n");

    if (out) {
      await withLock(`file:${fp}`, async () => {
        await fsPromises.appendFile(fp, out + "\n", "utf-8");
      });
    }

    if (!client) {
      await saveClient({
        id: clientId,
        encryptionKey: usedKey,
        createdAt: now,
        lastSeen: now,
      });
    } else if (client.encryptionKey !== usedKey) {
      await saveClient({ id: clientId, encryptionKey: usedKey, lastSeen: now });
    } else {
      await saveClient({ id: clientId, lastSeen: now });
    }

    const ms = Date.now() - t0;
    if (ms > 250 && config.isProduction) {
      console.warn(`[Logs] Slow ingest ${clientId}: ${ms}ms`);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to ingest logs" });
  }
});

router.get("/clients/:clientId", requireAuth, async (req, res) => {
  try {
    const clientId = String(req.params.clientId || "").trim();
    const dir = path.join(CLIENT_LOG_DIR, clientId);
    if (!fs.existsSync(dir)) return res.json({ files: [] });
    const files = (await fsPromises.readdir(dir)).filter((f) =>
      f.endsWith(".log"),
    );
    files.sort().reverse();
    return res.json({ files });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to list client logs" });
  }
});

router.get("/clients/:clientId/:date", requireAuth, async (req, res) => {
  try {
    const clientId = String(req.params.clientId || "").trim();
    const date = String(req.params.date || "").trim();
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ message: "date required (YYYY-MM-DD)" });
    }
    const fp = path.join(CLIENT_LOG_DIR, clientId, `${date}.log`);
    if (!fs.existsSync(fp))
      return res.status(404).json({ message: "Not found" });
    return res.sendFile(fp);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to download client logs" });
  }
});

router.get("/server", requireAuth, async (_req, res) => {
  try {
    if (!fs.existsSync(SERVER_LOG_DIR)) return res.json({ files: [] });
    const files = (await fsPromises.readdir(SERVER_LOG_DIR)).filter((f) =>
      f.endsWith(".log"),
    );
    files.sort().reverse();
    return res.json({ files });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to list server logs" });
  }
});

router.get("/server/:date", requireAuth, async (req, res) => {
  try {
    const date = String(req.params.date || "").trim();
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ message: "date required (YYYY-MM-DD)" });
    }
    const fp = path.join(SERVER_LOG_DIR, `${date}.log`);
    if (!fs.existsSync(fp))
      return res.status(404).json({ message: "Not found" });
    return res.sendFile(fp);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to download server logs" });
  }
});

export default router;
