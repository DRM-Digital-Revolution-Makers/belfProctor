import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { appendEvent, upsertAppStat, getAppStats } from "../store";
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
    if (process.env.NO_DB) {
      encryptionKey = "ABCDEFGHIJKLMNOP";
    } else {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client || !client.encryptionKey) {
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }
      encryptionKey = client.encryptionKey;
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

    if (process.env.NO_DB) {
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
    }

    // Prisma Mode
    if (Array.isArray(payload)) {
      const eventsData = payload
        .map((p) => {
          // We can also aggregate in DB mode if we want, but sticking to NO_DB focus for now.
          // Actually, let's replicate the logic: if ProcessStarted, don't log to Event table?
          // The user asked to "fix" it.
          // If I don't log to DB, I lose history in DB mode.
          // But for Win8 NO_DB, it's file based.
          // I'll keep DB behavior as is for safety, or minimal change.
          // BUT, if I want to use the same Frontend logic, I should probably expose /stats for DB too.
          // Implementing /stats for DB would require a GroupBy query.

          // For now, let's just focus on NO_DB logic as per user context (Win8).
          const rawType = p.EventType ?? p.eventType;
          const eventType =
            typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;
          return {
            clientId,
            timestamp: new Date(p.Timestamp || p.timestamp || Date.now()),
            eventType: eventType as any,
            description: p.Description || p.description,
            details: p.Details || p.details,
            processName: p.ProcessName || p.processName,
            deviceId: p.DeviceId || p.deviceId,
            networkAddress: p.NetworkAddress || p.networkAddress,
            additionalData: p.AdditionalData || p.additionalData || undefined,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (eventsData.length > 0) {
        await prisma.event.createMany({ data: eventsData });
      }
      return res.json({ count: eventsData.length });
    }

    // Single event DB mode
    // ... (keeping existing DB logic for single event)
    const rawType = payload.EventType ?? payload.eventType;
    const eventType =
      typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;
    if (!eventType)
      return res.status(400).json({ message: "Invalid event type" });

    const event = await prisma.event.create({
      data: {
        clientId,
        timestamp: new Date(
          payload.Timestamp || payload.timestamp || Date.now()
        ),
        eventType: eventType as any,
        description: payload.Description || payload.description,
        details: payload.Details || payload.details,
        processName: payload.ProcessName || payload.processName,
        deviceId: payload.DeviceId || payload.deviceId,
        networkAddress: payload.NetworkAddress || payload.networkAddress,
        additionalData:
          payload.AdditionalData || payload.additionalData || undefined,
      },
    });
    res.json({ id: event.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest event" });
  }
});

router.get("/stats", async (req, res) => {
  // Return aggregated app stats
  // In NO_DB mode, read from apps.json
  // In DB mode, we could group by processName.
  if (process.env.NO_DB) {
    const stats = getAppStats();
    // Sort by count desc
    stats.sort((a, b) => b.count - a.count);
    return res.json(stats);
  }

  // DB Mode implementation (optional, but good for completeness)
  try {
    const stats = await prisma.event.groupBy({
      by: ["processName", "clientId"],
      where: { eventType: "ProcessStarted" },
      _count: { processName: true },
      _max: { timestamp: true },
    });
    const mapped = stats.map((s: any) => ({
      clientId: s.clientId,
      processName: s.processName || "Unknown",
      count: s._count.processName,
      lastSeen: s._max.timestamp?.toISOString() || new Date().toISOString(),
    }));
    mapped.sort((a: any, b: any) => b.count - a.count);
    res.json(mapped);
  } catch (e) {
    res.json([]);
  }
});

router.get("/", async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const p = parseInt(page);
  const ps = parseInt(pageSize);

  if (process.env.NO_DB) {
    // Read events.jsonl
    const filePath = path.join(process.cwd(), "storage", "events.jsonl");
    if (!fs.existsSync(filePath)) return res.json({ data: [], total: 0 });

    const fileStream = fs.readFileSync(filePath, "utf-8");
    const lines = fileStream.split("\n").filter((l) => l.trim());
    // Parse all? Might be slow for large files, but for Win8 single server it's okay.
    // Optimization: Read backwards?
    // For now, just parse all and filter.
    let allEvents = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return null;
        }
      })
      .filter((e) => e !== null);

    // Sort desc
    allEvents.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (clientId) {
      allEvents = allEvents.filter((e) => e.clientId === clientId);
    }

    // Filter out system noise as per user request ("Only applications")
    const NOISE_EVENTS = [
      "NetworkConnection",
      "NetworkDisconnection",
      "USBConnected",
      "USBDisconnected",
      "FileAccess",
      "RegistryAccess",
      "SystemError",
    ];
    allEvents = allEvents.filter((e) => !NOISE_EVENTS.includes(e.eventType));

    const total = allEvents.length;
    const paginated = allEvents.slice((p - 1) * ps, p * ps);

    return res.json({ data: paginated, total });
  }

  const skip = (p - 1) * ps;

  // Filter out system noise for DB mode too
  const NOISE_EVENTS = [
    "NetworkConnection",
    "NetworkDisconnection",
    "USBConnected",
    "USBDisconnected",
    "FileAccess",
    "RegistryAccess",
    "SystemError",
  ];

  const where: any = {
    ...(clientId ? { clientId: String(clientId) } : {}),
    eventType: { notIn: NOISE_EVENTS },
  };

  const [items, total] = await Promise.all([
    (prisma as any).event.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: ps,
    }),
    (prisma as any).event.count({ where }),
  ]);
  res.json({ data: items, total });
});

export default router;
