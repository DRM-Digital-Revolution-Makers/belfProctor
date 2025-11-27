import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  res.json(clients);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).json({ message: "Not found" });
  res.json(client);
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

router.delete("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  try {
    await prisma.client.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ message: "Not found" });
  }
});

export default router;
