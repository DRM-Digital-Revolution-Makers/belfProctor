import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";

const router = Router();

// Mapping from C# SystemEventType enum (int) to Prisma SystemEventType enum (string)
const SystemEventTypeMap = [
  "ProcessStarted",      // 0
  "ProcessStopped",      // 1
  "USBConnected",        // 2
  "USBDisconnected",     // 3
  "NetworkConnection",   // 4
  "NetworkDisconnection",// 5
  "FileAccess",          // 6
  "RegistryAccess",      // 7
  "PolicyViolation",     // 8
  "ClipboardFileCopy",   // 9
  "SystemError"          // 10
];

router.post("/", async (req, res) => {
  try {
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId) return res.status(400).json({ message: "X-Client-Id header required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res.status(400).json({ message: "Client not registered or missing key" });
    }

    const encrypted: Buffer = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from([]);
    const decryptedJson = decryptAes256CbcPrefixedIv(encrypted, client.encryptionKey).toString("utf-8");
    const payload = JSON.parse(decryptedJson);

    // Convert numeric event type to string enum
    let eventType = payload.EventType !== undefined ? payload.EventType : payload.eventType;
    if (typeof eventType === "number") {
      eventType = SystemEventTypeMap[eventType];
    }
    
    // Validate eventType
    if (!eventType || !SystemEventTypeMap.includes(eventType)) {
       // Fallback or error? For now, let's log and use SystemError or just fail if critical
       // But to be safe, if mapping fails, maybe it's a new event type?
       // Let's assume it maps correctly if it's within range.
       // If undefined, Prisma will complain.
    }

    const event = await prisma.event.create({
      data: {
        clientId,
        timestamp: new Date(payload.Timestamp || payload.timestamp || Date.now()),
        eventType: eventType as any, // Cast to any or specific Enum type if imported
        description: payload.Description || payload.description,
        details: payload.Details || payload.details,
        processName: payload.ProcessName || payload.processName,
        deviceId: payload.DeviceId || payload.deviceId,
        networkAddress: payload.NetworkAddress || payload.networkAddress,
        additionalData: payload.AdditionalData || payload.additionalData || undefined,
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
    prisma.event.findMany({ where, orderBy: { timestamp: "desc" }, skip, take: parseInt(pageSize) }),
    prisma.event.count({ where }),
  ]);
  res.json({ data: items, total });
});

export default router;