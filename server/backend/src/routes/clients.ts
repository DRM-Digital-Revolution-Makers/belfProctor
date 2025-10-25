import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  res.json(clients);
});

// Optional: register client with encryption key
router.post("/register", requireAuth, async (req, res) => {
  const { id, encryptionKey } = req.body as { id: string; encryptionKey: string };
  if (!id || !encryptionKey) return res.status(400).json({ message: "id and encryptionKey required" });
  const client = await prisma.client.upsert({
    where: { id },
    create: { id, encryptionKey },
    update: { encryptionKey },
  });
  res.json(client);
});

export default router;