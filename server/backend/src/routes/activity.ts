import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import {
  appendActivity,
  getClient,
  saveClient,
  getLatestActivity,
  getLatestActivityPerClient,
  ingestActivityToTimesheetAndClient,
} from "../store";
import { getSenderClientId } from "../clientId";
import { getKeysToTry } from "../keyring";

const router = Router();

router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const clientId = getSenderClientId(req);

    let encryptionKey = "";
    const client = await getClient(clientId);
    const keysToTry = getKeysToTry(client?.encryptionKey);

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);

    let json = "";
    let usedKey = "";

    for (const key of keysToTry) {
      try {
        json = decryptAes256CbcPrefixedIv(encrypted, key).toString("utf-8");
        JSON.parse(json); // Validate JSON
        usedKey = key;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!usedKey) {
      const now = new Date();
      if (!client) {
        await saveClient({ id: clientId, createdAt: now, lastSeen: now });
      } else {
        await saveClient({ id: clientId, lastSeen: now });
      }
      console.error(
        `[Activity] Failed to decrypt for client ${clientId}. Tried ${keysToTry.length} keys.`,
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(json);
    const now = new Date();
    const sampleTs = new Date(
      payload.Timestamp || payload.timestamp || Date.now(),
    );
    const activeMs = parseInt(
      String(payload.ActiveMilliseconds ?? payload.activeMilliseconds ?? 0),
      10,
    );
    const inactiveMs = parseInt(
      String(payload.InactiveMilliseconds ?? payload.inactiveMilliseconds ?? 0),
      10,
    );

    await ingestActivityToTimesheetAndClient(
      clientId,
      usedKey,
      now,
      isNaN(sampleTs.getTime()) ? now : sampleTs,
      Number.isFinite(activeMs) ? activeMs : 0,
      Number.isFinite(inactiveMs) ? inactiveMs : 0,
    );

    await appendActivity({
      clientId,
      timestamp: isNaN(sampleTs.getTime()) ? now : sampleTs,
      isActive: Boolean(payload.IsActive ?? payload.isActive ?? false),
      activeMilliseconds: Number.isFinite(activeMs) ? activeMs : 0,
      inactiveMilliseconds: Number.isFinite(inactiveMs) ? inactiveMs : 0,
    });
    const ms = Date.now() - t0;
    if (ms > 100 && process.env.NODE_ENV === "production") {
      console.warn(`[Activity] Slow request ${clientId}: ${ms}ms`);
    }
    return res.json({ id: "file-saved" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest activity" });
  }
});

router.get("/", async (req, res) => {
  const data = await getLatestActivity(100);
  return res.json({ data, total: data.length });
});

router.get("/latest", async (req, res) => {
  const q: any = (req as any).query || {};
  const global = String(q.global || "") === "1";

  if (global) {
    const limit = Number.parseInt(String(q.limit || "20"), 10);
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(500, limit))
      : 20;
    const data = await getLatestActivity(safeLimit);
    return res.json({ data });
  }

  const clients = Number.parseInt(String(q.clients || "1000"), 10);
  const safeClients = Number.isFinite(clients)
    ? Math.max(1, Math.min(5000, clients))
    : 1000;

  const data = await getLatestActivityPerClient(safeClients);
  return res.json({ data });
});

export default router;
