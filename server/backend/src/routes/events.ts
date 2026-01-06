import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { appendEvent, upsertAppStat, getAppStats, getClient } from "../store";
import fs from "fs";
import path from "path";

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
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId)
      return res.status(400).json({ message: "X-Client-Id header required" });

    let encryptionKey = "";
    const client = getClient(clientId);
    if (client && client.encryptionKey) {
      encryptionKey = client.encryptionKey;
    } else {
      encryptionKey =
        process.env.ENCRYPTION_KEY ||
        "0000000000000000000000000000000000000000000000000000000000000000";
    }

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);
    const decryptedJson = decryptAes256CbcPrefixedIv(
      encrypted,
      encryptionKey
    ).toString("utf-8");
    const payload = JSON.parse(decryptedJson);

    const processPayload = (p: any) => {
      const rawType = p.EventType ?? p.eventType;
      const eventType =
        typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;
      const timestamp = new Date(p.Timestamp || p.timestamp || Date.now());
      const processName = p.ProcessName || p.processName;

      // Update stats for ProcessStarted AND AppUsage
      if (
        (eventType === "ProcessStarted" || eventType === "AppUsage") &&
        processName
      ) {
        upsertAppStat(clientId, processName, timestamp);
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
      payload.forEach((p) => {
        const event = processPayload(p);
        if (event) appendEvent(event);
      });
      return res.json({ count: payload.length });
    } else {
      const event = processPayload(payload);
      if (event) appendEvent(event);
      return res.json({ id: "file-saved" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest event" });
  }
});

router.get("/stats", async (req, res) => {
  // Return aggregated app stats
  // In NO_DB mode, read from apps.json
  const stats = getAppStats();
  // Sort by count desc
  stats.sort((a, b) => b.count - a.count);
  return res.json(stats);
});

router.get("/", async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  const eventsDir = path.join(process.cwd(), "storage", "events");
  if (!fs.existsSync(eventsDir)) {
    return res.json({ data: [], total: 0 });
  }

  let allEvents: any[] = [];

  try {
    if (clientId) {
      const filePath = path.join(eventsDir, `${clientId}.jsonl`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim());
        allEvents = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter((e) => e !== null) as any[];
      }
    } else {
      const files = fs
        .readdirSync(eventsDir)
        .filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(eventsDir, f), "utf-8");
          const lines = content.split("\n").filter((l) => l.trim());
          // Optimization: only parse the last 200 lines per file
          const lastLines = lines.slice(-200);
          lastLines.forEach((l) => {
            try {
              const obj = JSON.parse(l);
              allEvents.push(obj);
            } catch {}
          });
        } catch {}
      }
    }
  } catch (e) {
    console.error(e);
  }

  allEvents.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const total = allEvents.length;
  const paginated = allEvents.slice((p - 1) * ps, p * ps);

  return res.json({ data: paginated, total });
});

export default router;
