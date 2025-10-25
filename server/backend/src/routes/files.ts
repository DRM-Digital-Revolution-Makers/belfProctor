import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { requireAuth } from "../middleware/auth";

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

router.post("/screenshots", upload.single("screenshot"), async (req, res) => {
  try {
    const clientId = (req.body.clientId as string) || (req.headers["x-client-id"] as string) || "";
    const timestampStr = (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file) return res.status(400).json({ message: "clientId and screenshot required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res.status(400).json({ message: "Client not registered or missing key" });
    }

    const decrypted = decryptAes256CbcPrefixedIv(req.file.buffer, client.encryptionKey);
    const clientDir = path.join(UPLOAD_DIR, "screenshots", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const filename = `${timestampStr.replace(/[:]/g, "-")}_${Date.now()}.jpg`;
    const filepath = path.join(clientDir, filename);
    fs.writeFileSync(filepath, decrypted);

    const rec = await prisma.screenshot.create({
      data: {
        clientId,
        timestamp: new Date(timestampStr),
        filename,
        path: filepath,
      },
    });

    res.json({ id: rec.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest screenshot" });
  }
});

router.post("/reports", upload.single("report"), async (req, res) => {
  try {
    const clientId = (req.body.clientId as string) || (req.headers["x-client-id"] as string) || "";
    const timestampStr = (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file) return res.status(400).json({ message: "clientId and report required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res.status(400).json({ message: "Client not registered or missing key" });
    }

    const decrypted = decryptAes256CbcPrefixedIv(req.file.buffer, client.encryptionKey);
    const clientDir = path.join(UPLOAD_DIR, "reports", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const filename = `${timestampStr.replace(/[:]/g, "-")}_${Date.now()}`;
    const filepath = path.join(clientDir, filename);
    fs.writeFileSync(filepath, decrypted);

    const rec = await prisma.report.create({
      data: {
        clientId,
        timestamp: new Date(timestampStr),
        filename,
        path: filepath,
      },
    });

    res.json({ id: rec.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest report" });
  }
});

// Listings for admin
router.get("/screenshots", requireAuth, async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.screenshot.findMany({ where, orderBy: { timestamp: "desc" }, skip, take: parseInt(pageSize) }),
    prisma.screenshot.count({ where }),
  ]);
  res.json({ data: items, total });
});

router.get("/reports", requireAuth, async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.report.findMany({ where, orderBy: { timestamp: "desc" }, skip, take: parseInt(pageSize) }),
    prisma.report.count({ where }),
  ]);
  res.json({ data: items, total });
});

// Secure file serving
router.get("/screenshots/:id/file", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rec = await prisma.screenshot.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ message: "Not found" });
  res.sendFile(rec.path);
});

router.get("/reports/:id/file", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rec = await prisma.report.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ message: "Not found" });
  res.sendFile(rec.path);
});

export default router;