import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import {
  appendEvent,
  upsertAppStat,
  getAppStats,
  getClient,
  saveClient,
} from "../store";
import { getSenderClientId } from "../clientId";
import { getKeysToTry } from "../keyring";
import { prisma } from "../prisma";
import { now as authoritativeNow, reconcile as reconcileTime } from "../serverTime";
import { requireAuth } from "../middleware/auth";

const router = Router();

const EVENT_TYPE_MAP = [
  "ProcessStarted",
  "ProcessStopped",
  "USBConnected",
  "USBDisconnected",
  "NetworkConnection",
  "NetworkDisconnection",
  "FileAccess",
  "RegistryAccess",
  "PolicyViolation",
  "SystemError",
  "AppUsage",
];

router.post("/", async (req, res) => {
  try {
    const clientId = getSenderClientId(req);

    let encryptionKey = "";
    const client = await getClient(clientId);
    const keysToTry = getKeysToTry(client?.encryptionKey);

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);

    let decryptedJson = "";
    let usedKey = "";

    for (const key of keysToTry) {
      try {
        decryptedJson = decryptAes256CbcPrefixedIv(encrypted, key).toString(
          "utf-8",
        );
        JSON.parse(decryptedJson); // Validate JSON
        usedKey = key;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!usedKey) {
      const now = authoritativeNow();
      if (!client) {
        await saveClient({ id: clientId, createdAt: now, lastSeen: now });
      } else {
        await saveClient({ id: clientId, lastSeen: now });
      }
      console.error(
        `[Events] Failed to decrypt for client ${clientId}. Tried ${keysToTry.length} keys.`,
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(decryptedJson);
    const now = authoritativeNow();
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

    const processPayload = async (p: any) => {
      const rawType = p.EventType ?? p.eventType;
      const eventType =
        typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;
      const rawTs = p.Timestamp || p.timestamp;
      const clientTs = rawTs ? new Date(rawTs) : null;
      const timestamp = reconcileTime(clientTs && !isNaN(clientTs.getTime()) ? clientTs : null);
      const processName = p.ProcessName || p.processName;

      // Update stats only for foreground AppUsage so Top-apps reflect
      // what the user actually interacted with, not every spawned process.
      if (eventType === "AppUsage" && processName) {
        await upsertAppStat(clientId, processName, timestamp);
      }

      // Hide ProcessStarted from main log (noise reduction)
      if (eventType === "ProcessStarted") {
        return null;
      }

      return {
        clientId,
        timestamp,
        eventType,
        description: p.Description || p.description,
        details: p.Details || p.details,
        processName,
        deviceId: p.DeviceId || p.deviceId,
        networkAddress: p.NetworkAddress || p.networkAddress,
        additionalData: p.AdditionalData || p.additionalData || undefined,
      };
    };

    if (Array.isArray(payload)) {
      for (const p of payload) {
        const event = await processPayload(p);
        if (event) await appendEvent(event);
      }
      return res.json({ count: payload.length });
    } else {
      const event = await processPayload(payload);
      if (event) await appendEvent(event);
      return res.json({ id: "file-saved" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest event" });
  }
});

router.get("/stats", requireAuth, async (req, res) => {
  // Return aggregated app stats
  // In NO_DB mode, read from apps.json
  const stats = await getAppStats();
  // Sort by count desc
  stats.sort((a, b) => b.count - a.count);
  return res.json(stats);
});

router.get("/", requireAuth, async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(parseInt(pageSize, 10) || 20, 50);

  const where = clientId ? { clientId: String(clientId) } : {};
  const [data, total] = await prisma.$transaction([
    prisma.event.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (p - 1) * ps,
      take: ps,
    }),
    prisma.event.count({ where }),
  ]);

  return res.json({ data, total });
});

export default router;
