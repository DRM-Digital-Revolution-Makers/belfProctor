import { Router } from "express";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { appendActivity } from "../store";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId)
      return res.status(400).json({ message: "X-Client-Id header required" });

    let encryptionKey = "";
    if (process.env.NO_DB) {
      encryptionKey = "ABCDEFGHIJKLMNOP"; // Default key for file mode
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
    const json = decryptAes256CbcPrefixedIv(encrypted, encryptionKey).toString(
      "utf-8"
    );
    const payload = JSON.parse(json);

    if (process.env.NO_DB) {
      appendActivity({
        clientId,
        timestamp: new Date(
          payload.Timestamp || payload.timestamp || Date.now()
        ),
        isActive: Boolean(payload.IsActive ?? payload.isActive ?? false),
        activeMilliseconds: parseInt(
          String(payload.ActiveMilliseconds ?? payload.activeMilliseconds ?? 0),
          10
        ),
        inactiveMilliseconds: parseInt(
          String(
            payload.InactiveMilliseconds ?? payload.inactiveMilliseconds ?? 0
          ),
          10
        ),
      });
      return res.json({ id: "file-saved" });
    }

    const rec = await (prisma as any).activity.create({
      data: {
        clientId,
        timestamp: new Date(
          payload.Timestamp || payload.timestamp || Date.now()
        ),
        isActive: Boolean(payload.IsActive ?? payload.isActive ?? false),
        activeMilliseconds: parseInt(
          String(payload.ActiveMilliseconds ?? payload.activeMilliseconds ?? 0),
          10
        ),
        inactiveMilliseconds: parseInt(
          String(
            payload.InactiveMilliseconds ?? payload.inactiveMilliseconds ?? 0
          ),
          10
        ),
      },
    });

    res.json({ id: rec.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest activity" });
  }
});

router.get("/", async (req, res) => {
  if (process.env.NO_DB) return res.json({ data: [], total: 0 });

  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    (prisma as any).activity.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: parseInt(pageSize),
    }),
    (prisma as any).activity.count({ where }),
  ]);
  res.json({ data: items, total });
});

router.get("/latest", async (_req, res) => {
  if (process.env.NO_DB) return res.json({ data: [] });

  const items = await (prisma as any).activity.findMany({
    orderBy: { timestamp: "desc" },
    distinct: ["clientId"],
    take: 1000,
  });
  res.json({ data: items });
});

export default router;
