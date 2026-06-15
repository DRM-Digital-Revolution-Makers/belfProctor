import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { decryptAes256CbcPrefixedIv, decryptFileStream } from "../encryption";
import { requireAuth } from "../middleware/auth";
import {
  getClient,
  getClients,
  saveClient,
  getFavorites,
  setFavorite,
} from "../store";
import { getSenderClientId, normalizeClientId } from "../clientId";
import { withLock } from "../locks";
import { getKeysToTry } from "../keyring";
import { resolveUploadDir } from "../runtimePaths";
import { resolveWithinDir, safeFileName } from "../util/safePath";
import { prisma } from "../prisma";
import { startOfTashkentDay, endOfTashkentDay } from "../tz";
import { now as authoritativeNow, reconcile as reconcileTime } from "../serverTime";

const router = Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(os.tmpdir(), "belfproctor_uploads");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}`);
  },
});
const MAX_SCREENSHOT_BYTES = parseInt(
  process.env.MAX_SCREENSHOT_BYTES || String(20 * 1024 * 1024),
  10,
);
const MAX_REPORT_BYTES = parseInt(
  process.env.MAX_REPORT_BYTES || String(200 * 1024 * 1024),
  10,
);
const MAX_COMMAND_RESULT_BYTES = parseInt(
  process.env.MAX_COMMAND_RESULT_BYTES || String(512 * 1024 * 1024),
  10,
);

const uploadScreenshot = multer({
  storage,
  limits: { fileSize: MAX_SCREENSHOT_BYTES },
});
const uploadReport = multer({
  storage,
  limits: { fileSize: MAX_REPORT_BYTES },
});
const uploadCommandResult = multer({
  storage,
  limits: { fileSize: MAX_COMMAND_RESULT_BYTES },
});

const getUploadDir = () => resolveUploadDir();

async function ensurePrismaClient(clientId: string, encryptionKey?: string): Promise<void> {
  await prisma.client.upsert({
    where: { id: clientId },
    update: encryptionKey ? { encryptionKey } : {},
    create: { id: clientId, encryptionKey: encryptionKey || "" },
  });
}

router.post(
  "/screenshots",
  uploadScreenshot.single("screenshot"),
  async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const clientId =
        normalizeClientId(String((req as any).body?.clientId || "")) ||
        normalizeClientId(String(req.headers["x-client-id"] || "")) ||
        getSenderClientId(req);
      const timestampStr =
        (req.body.timestamp as string) || new Date().toISOString();
      if (!req.file || !tempPath)
        return res
          .status(400)
          .json({ message: "clientId and screenshot required" });

      const safeClientId = clientId;
      const now = authoritativeNow();
      let client: any = await getClient(safeClientId);
      if (!client) {
        await saveClient({ id: safeClientId, createdAt: now, lastSeen: now });
        client = await getClient(safeClientId);
      }

      const keysToTry = getKeysToTry(client?.encryptionKey);

      const clientDir = path.join(getUploadDir(), "screenshots", safeClientId);
      fs.mkdirSync(clientDir, { recursive: true });

      // Reconcile against the authoritative external time (Cloudflare/Google
      // Date header). If the client's clock is within 5 minutes of real time
      // we keep its precision (capture moment); otherwise we override with
      // server-authoritative now() — covers clients with broken Windows TZ.
      let tsToParse = timestampStr;
      if (
        !tsToParse.endsWith("Z") &&
        !/[+-]\d{2}:\d{2}$/.test(tsToParse)
      ) {
        tsToParse += "Z";
      }
      const tsParsed = new Date(tsToParse);
      const clientTs = isNaN(tsParsed.getTime()) ? null : tsParsed;
      const adjTs = reconcileTime(clientTs);
      const iso = adjTs.toISOString().replace(/[:]/g, "-");
      const filename = `${safeClientId}_${iso}.jpg`;
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
          `[Screenshots] Failed to decrypt for client ${safeClientId}. Tried ${keysToTry.length} keys.`,
        );
        return res.status(400).json({ message: "Decryption failed" });
      }
      const existing = await getClient(safeClientId);
      if (!existing || existing.encryptionKey !== usedKey) {
        await saveClient({
          id: safeClientId,
          encryptionKey: usedKey,
          lastSeen: now,
        });
      } else {
        await saveClient({ id: safeClientId, lastSeen: now });
      }

      const rec = {
        id: `${safeClientId}_${Date.now()}`,
        filename,
        path: filepath,
        timestamp: adjTs,
      };
      await ensurePrismaClient(safeClientId, usedKey);
      await prisma.screenshot.create({
        data: {
          clientId: safeClientId,
          timestamp: adjTs,
          filename,
          path: filepath,
          captureReason: String(req.body.captureReason || "").trim() || undefined,
          linkedSessionId: String(req.body.linkedSessionId || "").trim() || undefined,
          processName: String(req.body.processName || "").trim() || undefined,
          filePath: String(req.body.filePath || "").trim() || undefined,
          projectName: String(req.body.projectName || "").trim() || undefined,
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
  },
);

router.post("/reports", uploadReport.single("report"), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    const clientId =
      normalizeClientId(String((req as any).body?.clientId || "")) ||
      normalizeClientId(String(req.headers["x-client-id"] || "")) ||
      getSenderClientId(req);
    const timestampStr = new Date().toISOString();
    if (!req.file || !tempPath)
      return res.status(400).json({ message: "clientId and report required" });

    const safeClientId = clientId;
    const now = new Date();
    let client: any = await getClient(safeClientId);
    if (!client) {
      await saveClient({ id: safeClientId, createdAt: now, lastSeen: now });
      client = await getClient(safeClientId);
    }

    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(getUploadDir(), "reports", safeClientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const now2 = authoritativeNow();
    const filename = `${now2.toISOString().replace(/[:]/g, "-")}_${Date.now()}`;
    const filepath = path.join(clientDir, filename);

    await decryptFileStream(tempPath, filepath, client.encryptionKey);
    const existing = await getClient(safeClientId);
    if (!existing || existing.encryptionKey !== client.encryptionKey) {
      await saveClient({
        id: safeClientId,
        encryptionKey: client.encryptionKey,
        lastSeen: now,
      });
    } else {
      await saveClient({ id: safeClientId, lastSeen: now });
    }

    const rec = {
      id: `${safeClientId}_${Date.now()}`,
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
    const screenshotsDir = path.join(getUploadDir(), "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      return res.json({ data: [], total: 0 });
    }

    const favorites = new Set(await getFavorites());
    let allFiles: any[] = [];
    let clientDirs = fs.readdirSync(screenshotsDir);

    const filterCategory = String(req.query.category || "").trim();
    if (filterCategory) {
      const clients = await getClients();
      const allowed = new Set(
        clients
          .filter((c) => String(c?.category || "") === filterCategory)
          .map((c) => c.id),
      );
      clientDirs = clientDirs.filter((id) => allowed.has(id));
    }

    // If a specific Tashkent day is requested, read the full set for that window.
    // Otherwise apply a soft cap so the global overview doesn't load tens of thousands.
    const dateStr = String(req.query.date || "").trim();
    const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    const dayFrom = dateMatch
      ? startOfTashkentDay(new Date(`${dateStr}T12:00:00Z`))
      : null;
    const dayTo = dateMatch
      ? endOfTashkentDay(new Date(`${dateStr}T12:00:00Z`))
      : null;
    const maxPerClient = dayFrom ? Infinity : 200;
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
        .slice(0, Number.isFinite(maxPerClient) ? maxPerClient : files.length);
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
        if (dayFrom && dayTo) {
          if (timestamp < dayFrom || timestamp > dayTo) continue;
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
    // Reject anything that is not a bare image file name. This alone defeats
    // path traversal; resolveWithinDir below is defense-in-depth.
    const filename = safeFileName(req.params.filename, /\.(jpe?g|png)$/i);
    if (!filename) {
      return res.status(400).json({ message: "Invalid filename" });
    }
    const screenshotsDir = path.join(getUploadDir(), "screenshots");
    const clientIdMatch = filename.match(/^(.+)_\d{4}-\d{2}-\d{2}T/);
    const candidatePaths: string[] = [];

    if (clientIdMatch?.[1]) {
      const direct = resolveWithinDir(screenshotsDir, clientIdMatch[1], filename);
      if (direct) candidatePaths.push(direct);
    }

    if (fs.existsSync(screenshotsDir)) {
      for (const dirent of fs.readdirSync(screenshotsDir, {
        withFileTypes: true,
      })) {
        if (!dirent.isDirectory()) continue;
        const candidate = resolveWithinDir(
          screenshotsDir,
          dirent.name,
          filename,
        );
        if (candidate && !candidatePaths.includes(candidate)) {
          candidatePaths.push(candidate);
        }
      }
    }

    const filePath = candidatePaths.find((candidate) =>
      fs.existsSync(candidate),
    );

    if (!filePath) {
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
router.post(
  "/commands/:id/result",
  uploadCommandResult.single("file"),
  async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const id = req.params.id;
      const clientId =
        normalizeClientId(String((req as any).body?.clientId || "")) ||
        normalizeClientId(String(req.headers["x-client-id"] || "")) ||
        getSenderClientId(req);
      const timestampStr =
        (req.body.timestamp as string) || new Date().toISOString();
      if (!req.file || !tempPath)
        return res.status(400).json({ message: "clientId and file required" });

      const now = authoritativeNow();
      let client: any = await getClient(clientId);
      if (!client) {
        await saveClient({ id: clientId, createdAt: now, lastSeen: now });
        client = await getClient(clientId);
      }

      if (!client || !client.encryptionKey) {
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }

      const clientDir = path.join(getUploadDir(), "commands", clientId);
      fs.mkdirSync(clientDir, { recursive: true });
      const filename = `${id}_${timestampStr.replace(/[:]/g, "-")}_${Date.now()}`;
      const filepath = path.join(clientDir, filename);

      await withLock(`file:${filepath}`, async () => {
        await decryptFileStream(tempPath, filepath, client.encryptionKey);
      });
      await saveClient({
        id: clientId,
        encryptionKey: client.encryptionKey,
        lastSeen: now,
      });

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
  },
);

// Admin: download latest file result for a command id
router.get("/commands/:id/file/latest", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const baseDir = path.join(getUploadDir(), "commands");
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
