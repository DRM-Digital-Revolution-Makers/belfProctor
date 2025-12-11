import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";

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

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);
    const decryptedJson = decryptAes256CbcPrefixedIv(
      encrypted,
      client.encryptionKey
    ).toString("utf-8");
    const payload = JSON.parse(decryptedJson);

    if (Array.isArray(payload)) {
      const eventsData = payload
        .map((p) => {
          const rawType = p.EventType ?? p.eventType;
          const eventType =
            typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;
          if (!eventType) return null;

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

    const rawType = payload.EventType ?? payload.eventType;
    const eventType =
      typeof rawType === "number" ? EVENT_TYPE_MAP[rawType] : rawType;

    if (!eventType) {
      return res.status(400).json({ message: "Invalid event type" });
    }

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

// Admin list
router.get("/", async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: parseInt(pageSize),
    }),
    prisma.event.count({ where }),
  ]);
  res.json({ data: items, total });
});

export default router;
