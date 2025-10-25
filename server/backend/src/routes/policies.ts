import { Router } from "express";
import { prisma } from "../prisma";
import { encryptAes256CbcPrefixedIv } from "../encryption";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Admin list
router.get("/", requireAuth, async (_req, res) => {
  const policies = await prisma.policy.findMany({ orderBy: { updatedAt: "desc" } });
  res.json(policies);
});

// Client download (encrypted)
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  const clientId = (req.headers["x-client-id"] as string) || "";
  if (!clientId) return res.status(400).json({ message: "X-Client-Id header required" });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || !client.encryptionKey) {
    return res.status(400).json({ message: "Client not registered or missing key" });
  }

  const policy = await prisma.policy.findUnique({ where: { id } });
  if (!policy) return res.status(404).json({ message: "Policy not found" });

  const payload = Buffer.from(JSON.stringify(policy), "utf-8");
  const encrypted = encryptAes256CbcPrefixedIv(payload, client.encryptionKey);
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(encrypted);
});

export default router;