import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import {
  appendActivity,
  getClient,
  getLatestActivity,
  getLatestActivityPerClient,
} from "../store";

const router = Router();

router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId)
      return res.status(400).json({ message: "X-Client-Id header required" });

    let encryptionKey = "";
    const client = await getClient(clientId);
    let keysToTry: string[] = [];

    if (client && client.encryptionKey) {
      keysToTry.push(client.encryptionKey);
    }

    const globalKey =
      process.env.ENCRYPTION_KEY ||
      "0000000000000000000000000000000000000000000000000000000000000000";
    if (!keysToTry.includes(globalKey)) {
      keysToTry.push(globalKey);
    }

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
      console.error(
        `[Activity] Failed to decrypt for client ${clientId}. Tried ${keysToTry.length} keys.`,
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(json);

    await appendActivity({
      clientId,
      timestamp: new Date(payload.Timestamp || payload.timestamp || Date.now()),
      isActive: Boolean(payload.IsActive ?? payload.isActive ?? false),
      activeMilliseconds: parseInt(
        String(payload.ActiveMilliseconds ?? payload.activeMilliseconds ?? 0),
        10,
      ),
      inactiveMilliseconds: parseInt(
        String(
          payload.InactiveMilliseconds ?? payload.inactiveMilliseconds ?? 0,
        ),
        10,
      ),
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
