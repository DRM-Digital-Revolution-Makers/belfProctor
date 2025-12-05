import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { encryptAes256CbcPrefixedIv } from "../encryption";

const router = Router();

// Client download (encrypted)
// Client requests: GET /api/whitelist/client/Telegram
router.get("/client/:name", async (req, res) => {
  const name = req.params.name;
  const clientId = (req.headers["x-client-id"] as string) || "";
  
  if (!clientId) return res.status(400).json({ message: "X-Client-Id header required" });

  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res.status(400).json({ message: "Client not registered or missing key" });
    }

    const whitelist = await prisma.whitelist.findUnique({ where: { name } });
    
    // If whitelist doesn't exist, return empty array (encrypted)
    // This allows the client to work even if the admin hasn't created the list yet.
    const items = whitelist ? whitelist.items : [];
    
    const payload = Buffer.from(JSON.stringify(items), "utf-8");
    const encrypted = encryptAes256CbcPrefixedIv(payload, client.encryptionKey);
    
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(encrypted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching whitelist" });
  }
});

// List all whitelists
router.get("/", requireAuth, async (req, res) => {
  try {
    const whitelists = await prisma.whitelist.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(whitelists);
  } catch (error) {
    res.status(500).json({ message: "Error fetching whitelists", error });
  }
});

// Get specific whitelist
router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const whitelist = await prisma.whitelist.findUnique({
      where: { id: Number(id) },
    });
    if (!whitelist) return res.status(404).json({ message: "Whitelist not found" });
    res.json(whitelist);
  } catch (error) {
    res.status(500).json({ message: "Error fetching whitelist", error });
  }
});

// Create new whitelist
router.post("/", requireAuth, async (req, res) => {
  const { name, items } = req.body;
  if (!name) return res.status(400).json({ message: "Name is required" });
  
  try {
    const whitelist = await prisma.whitelist.create({
      data: {
        name,
        items: items || [],
      },
    });
    res.json(whitelist);
  } catch (error) {
    res.status(500).json({ message: "Error creating whitelist", error });
  }
});

// Update whitelist
router.put("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, items } = req.body;
  
  try {
    const whitelist = await prisma.whitelist.update({
      where: { id: Number(id) },
      data: {
        name,
        items,
      },
    });
    res.json(whitelist);
  } catch (error) {
    res.status(500).json({ message: "Error updating whitelist", error });
  }
});

// Delete whitelist
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  
  try {
    await prisma.whitelist.delete({
      where: { id: Number(id) },
    });
    res.json({ message: "Whitelist deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting whitelist", error });
  }
});

export default router;
