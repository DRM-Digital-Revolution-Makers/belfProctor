import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { appendHeartbeat } from "../store";

const router = Router();

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

    if (process.env.NO_DB) {
      appendHeartbeat({
        clientId,
        timestamp: new Date(),
        status: payload.Status || payload.status || "Online",
        version: payload.Version || payload.version || "",
      });
      return res.json({ ok: true });
    }

    await prisma.heartbeat.create({
      data: {
        clientId,
        timestamp: new Date(), // Always use server time for reliable online/offline status
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
  if (process.env.NO_DB) return res.json({ data: [], total: 0 });

  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.heartbeat.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: parseInt(pageSize),
    }),
    prisma.heartbeat.count({ where }),
  ]);
  res.json({ data: items, total });
});

router.get("/latest", async (_req, res) => {
  if (process.env.NO_DB) return res.json({ data: [] });

  const items = await prisma.heartbeat.findMany({
    orderBy: { timestamp: "desc" },
    distinct: ["clientId"],
    take: 1000,
  });
  res.json({ data: items });
});

export default router;
