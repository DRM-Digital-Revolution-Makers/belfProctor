import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../prisma";
import { decryptAes256CbcPrefixedIv, decryptFileStream } from "../encryption";
import { requireAuth } from "../middleware/auth";

const router = Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(process.cwd(), "temp_uploads");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

router.post("/screenshots", upload.single("screenshot"), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr =
      (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file || !tempPath)
      return res
        .status(400)
        .json({ message: "clientId and screenshot required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(UPLOAD_DIR, "screenshots", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const tsParsed = new Date(timestampStr);
    const sendTs = isNaN(tsParsed.getTime()) ? new Date() : tsParsed;
    // Use the timestamp exactly as received (no -2h hack)
    const adjTs = sendTs;
    const iso = adjTs.toISOString().replace(/[:]/g, "-");
    const filename = `${clientId}_${iso}.jpg`;
    const filepath = path.join(clientDir, filename);

    await decryptFileStream(tempPath, filepath, client.encryptionKey);

    const rec = await prisma.screenshot.create({
      data: {
        clientId,
        timestamp: adjTs,
        filename,
        path: filepath,
      },
    });

    res.json({
      ok: true,
      id: rec.id,
      filename,
      path: filepath,
      timestamp: adjTs.toISOString(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest screenshot" });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
});

router.post("/reports", upload.single("report"), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr = new Date().toISOString();
    if (!clientId || !req.file || !tempPath)
      return res.status(400).json({ message: "clientId and report required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(UPLOAD_DIR, "reports", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const now2 = new Date();
    const filename = `${now2.toISOString().replace(/[:]/g, "-")}_${Date.now()}`;
    const filepath = path.join(clientDir, filename);

    await decryptFileStream(tempPath, filepath, client.encryptionKey);

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
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
  }
});

// Listings for admin
router.get("/screenshots", requireAuth, async (req, res) => {
  const {
    page = "1",
    pageSize = "20",
    clientId,
    isFavorite,
  } = req.query as any;
  const where: any = {};
  if (clientId) where.clientId = String(clientId);
  if (isFavorite === "true") where.isFavorite = true;

  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const [items, total] = await Promise.all([
    prisma.screenshot.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: parseInt(pageSize),
    }),
    prisma.screenshot.count({ where }),
  ]);

  res.json({ data: items, total });
});

router.put("/screenshots/:id/favorite", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { isFavorite } = req.body;
  try {
    const updated = await prisma.screenshot.update({
      where: { id },
      data: { isFavorite: Boolean(isFavorite) },
    });
    res.json(updated);
  } catch (e) {
    res.status(404).json({ message: "Not found" });
  }
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

// Reports CSV export
router.get("/reports/:id/csv", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rec = await prisma.report.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ message: "Not found" });
    if (!rec.path || !fs.existsSync(rec.path))
      return res.status(404).json({ message: "Not found" });

    const content = fs.readFileSync(rec.path, "utf-8");
    let data: any;
    try {
      data = JSON.parse(content);
    } catch {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(400).send("Report is not valid JSON");
    }

    let rows: any[] = [];
    if (Array.isArray(data?.Events)) {
      rows = (data.Events as any[]).map((e) => ({
        Timestamp: e.Timestamp ?? e.timestamp,
        EventType: e.EventType ?? e.eventType,
        Description: e.Description ?? e.description,
        ProcessName: e.ProcessName ?? e.processName,
        DeviceId: e.DeviceId ?? e.deviceId,
        NetworkAddress: e.NetworkAddress ?? e.networkAddress,
      }));
    } else if (Array.isArray(data?.Entries)) {
      rows = [];
      for (const entry of data.Entries as any[]) {
        const root = entry.root ?? "";
        for (const d of entry.directories ?? []) {
          rows.push({
            Type: "dir",
            Name: d.name,
            FullPath: d.fullPath,
            LastWriteTime: d.lastWriteTime,
            Root: root,
          });
        }
        for (const f of entry.files ?? []) {
          rows.push({
            Type: "file",
            Name: f.name,
            FullPath: f.fullPath,
            Size: f.size,
            LastWriteTime: f.lastWriteTime,
            Root: root,
          });
        }
      }
    } else if (data?.SystemInfo || data?.Configuration || data?.Statistics) {
      const sys = data.SystemInfo ?? {};
      const conf = data.Configuration ?? {};
      const stats = data.Statistics ?? {};
      rows = [
        {
          Timestamp: data.Timestamp,
          ClientId: data.ClientId,
          MachineName: sys.MachineName,
          UserName: sys.UserName,
          OSVersion: sys.OSVersion,
          ProcessorCount: sys.ProcessorCount,
          WorkingSet: sys.WorkingSet,
          ScreenshotInterval: conf.ScreenshotInterval,
          MonitorUSB: conf.MonitorUSB,
          MonitorProcesses: conf.MonitorProcesses,
          MonitorNetwork: conf.MonitorNetwork,
          ScreenshotsCount: stats.ScreenshotsCount,
          LogFilesCount: stats.LogFilesCount,
          TotalLogSize: stats.TotalLogSize,
          UptimeHours: stats.UptimeHours,
        },
      ];
    } else {
      rows = [data];
    }

    const headers = Array.from(
      new Set(rows.flatMap((r) => Object.keys(r ?? {})))
    );
    const escape = (v: any) => {
      const s = v === undefined || v === null ? "" : String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n")) {
        return `"${s.replace(/\"/g, '""')}"`;
      }
      return s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    const baseName = (rec.filename || `report_${id}`).replace(
      /[^a-zA-Z0-9_.-]/g,
      "_"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${baseName}.csv`
    );
    res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to export report as CSV" });
  }
});

// Command result file upload (encrypted)
router.post("/commands/:id/result", upload.single("file"), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    const id = req.params.id;
    const clientId =
      (req.body.clientId as string) ||
      (req.headers["x-client-id"] as string) ||
      "";
    const timestampStr =
      (req.body.timestamp as string) || new Date().toISOString();
    if (!clientId || !req.file || !tempPath)
      return res.status(400).json({ message: "clientId and file required" });

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(UPLOAD_DIR, "commands", clientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const filename = `${id}_${timestampStr.replace(/[:]/g, "-")}_${Date.now()}`;
    const filepath = path.join(clientDir, filename);

    await decryptFileStream(tempPath, filepath, client.encryptionKey);

    res.json({ ok: true, path: filepath });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest command file result" });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }
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
    if (!latestPath) return res.status(202).json({ message: "Pending" });
    res.sendFile(latestPath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch command file" });
  }
});

export default router;
