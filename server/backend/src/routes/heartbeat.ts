import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";

const router = Router();

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

    await prisma.heartbeat.create({
      data: {
        clientId,
        timestamp: new Date(payload.Timestamp || payload.timestamp || Date.now()),
        status: payload.Status || payload.status || "Online",
        version: payload.Version || payload.version || "",
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest heartbeat" });
  }
});

router.get("/", async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.heartbeat.findMany({ where, orderBy: { timestamp: "desc" }, skip, take: parseInt(pageSize) }),
    prisma.heartbeat.count({ where }),
  ]);
  res.json({ data: items, total });
});

router.get("/latest", async (_req, res) => {
  const items = await prisma.heartbeat.findMany({ orderBy: { timestamp: "desc" }, distinct: ["clientId"], take: 1000 });
  res.json({ data: items });
});

export default router;
