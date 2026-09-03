import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import { decryptAes256CbcPrefixedIv, decryptFileStream } from "../encryption";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getClient, saveClient, setFavorite } from "../store";
import { Prisma } from "@prisma/client";
import { getSenderClientId, normalizeClientId } from "../clientId";
import { withLock } from "../locks";
import { getKeysToTry } from "../keyring";
import { resolveUploadDir } from "../runtimePaths";
import { resolveWithinDir, safeFileName } from "../util/safePath";
import { createRecordOrUnlinkFile } from "../util/dbConsistency";
import {
  listReports,
  reportsRootDir,
  reportJsonToCsv,
} from "../services/reportStore";
import { prisma } from "../prisma";
import { startOfTashkentDay, endOfTashkentDay } from "../tz";
import { now as authoritativeNow, reconcile as reconcileTime } from "../serverTime";
import { isSafeCommandId } from "../util/commandId";
import { config } from "../config";

const router = Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(os.tmpdir(), "belfproctor_uploads");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${randomUUID()}`);
  },
});
const uploadScreenshot = multer({
  storage,
  limits: { fileSize: config.uploadLimits.screenshotBytes },
});
const uploadReport = multer({
  storage,
  limits: { fileSize: config.uploadLimits.reportBytes },
});
const uploadCommandResult = multer({
  storage,
  limits: { fileSize: config.uploadLimits.commandResultBytes },
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
      const client: any = await getClient(safeClientId);

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
      const rec = {
        id: `${safeClientId}_${Date.now()}`,
        filename,
        path: filepath,
        timestamp: adjTs,
      };

      // The .jpg is already on disk. Persist the accompanying DB rows with
      // compensation: if any write fails (e.g. the DB is down) the file is
      // unlinked so we never leave an orphan that no listing or retention
      // sweep can ever see.
      await createRecordOrUnlinkFile(filepath, async () => {
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
        await ensurePrismaClient(safeClientId, usedKey);
        await prisma.screenshot.create({
          data: {
            clientId: safeClientId,
            timestamp: adjTs,
            filename,
            path: filepath,
            captureReason:
              String(req.body.captureReason || "").trim() || undefined,
            linkedSessionId:
              String(req.body.linkedSessionId || "").trim() || undefined,
            processName: String(req.body.processName || "").trim() || undefined,
            filePath: String(req.body.filePath || "").trim() || undefined,
            projectName: String(req.body.projectName || "").trim() || undefined,
          },
        });
      });

      res.json({
        ok: true,
        id: rec.id,
        filename,
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
    if (!req.file || !tempPath)
      return res.status(400).json({ message: "clientId and report required" });

    const safeClientId = clientId;
    // Stamp with the authoritative server time (consistent with screenshots and
    // commands) rather than raw new Date() — fixes report timestamp drift on
    // hosts with a skewed clock [B-M1].
    const now = authoritativeNow();
    const client: any = await getClient(safeClientId);

    if (!client || !client.encryptionKey) {
      return res
        .status(400)
        .json({ message: "Client not registered or missing key" });
    }

    const clientDir = path.join(getUploadDir(), "reports", safeClientId);
    fs.mkdirSync(clientDir, { recursive: true });
    const iso = now.toISOString().replace(/[:]/g, "-");
    const filename = `report_${iso}_${Date.now()}.json`;
    const filepath = path.join(clientDir, filename);

    try {
      await decryptFileStream(tempPath, filepath, client.encryptionKey);
    } catch {
      return res.status(400).json({ message: "Decryption failed" });
    }

    // The report file is on disk; persist the DB row with compensation so a DB
    // failure never leaves an orphan file [B-C2].
    const created = await createRecordOrUnlinkFile(filepath, async () => {
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
      await ensurePrismaClient(safeClientId, client.encryptionKey);
      return prisma.report.create({
        data: {
          clientId: safeClientId,
          filename,
          path: filepath,
          timestamp: now,
        },
      });
    });

    res.json({ id: created.id, filename, timestamp: now.toISOString() });
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
router.put("/screenshots/:id/favorite", requireAdmin, async (req, res) => {
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

// Listings for admin — served from the indexed Screenshot table (not a disk
// scan, which did a statSync per file and degraded badly past ~10k files).
router.get("/screenshots", requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize || "20"), 10) || 20),
    );

    const where: Prisma.ScreenshotWhereInput = {};

    const filterClient = String(req.query.clientId || "").trim();
    if (filterClient) where.clientId = filterClient;

    if (req.query.isFavorite === "true") where.isFavorite = true;

    const dateStr = String(req.query.date || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const from = startOfTashkentDay(new Date(`${dateStr}T12:00:00Z`));
      const to = endOfTashkentDay(new Date(`${dateStr}T12:00:00Z`));
      where.timestamp = { gte: from, lte: to };
    }

    // Category filter → restrict to clients in that category.
    const filterCategory = String(req.query.category || "").trim();
    if (filterCategory) {
      const clients = await prisma.client.findMany({
        where: { category: filterCategory },
        select: { id: true },
      });
      const ids = clients.map((c) => c.id);
      if (typeof where.clientId === "string") {
        if (!ids.includes(where.clientId)) {
          return res.json({ data: [], total: 0 });
        }
      } else {
        where.clientId = { in: ids };
      }
    }

    const [rows, total] = await Promise.all([
      prisma.screenshot.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          clientId: true,
          filename: true,
          path: true,
          timestamp: true,
          isFavorite: true,
        },
      }),
      prisma.screenshot.count({ where }),
    ]);

    const data = rows.map((r) => ({
      id: r.filename,
      clientId: r.clientId,
      filename: r.filename,
      path: r.path,
      timestamp: r.timestamp,
      createdAt: r.timestamp,
      isFavorite: r.isFavorite,
    }));

    return res.json({ data, total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to list screenshots" });
  }
});

router.get("/reports", requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query.pageSize || "20"), 10) || 20),
    );
    const clientId = String(req.query.clientId || "").trim() || undefined;

    const dateStr = String(req.query.date || "").trim();
    let from: Date | undefined;
    let to: Date | undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      from = startOfTashkentDay(new Date(`${dateStr}T12:00:00Z`));
      to = endOfTashkentDay(new Date(`${dateStr}T12:00:00Z`));
    }

    const result = await listReports({ clientId, from, to, page, pageSize });
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to list reports" });
  }
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
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid report id" });
    }
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ message: "Report not found" });

    // Defense in depth: the stored path must resolve inside the reports root.
    const safePath = resolveWithinDir(
      reportsRootDir(getUploadDir()),
      report.clientId,
      report.filename,
    );
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({ message: "Report file missing" });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${report.filename}"`,
    );
    res.sendFile(safePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to serve report" });
  }
});

// Reports CSV export
router.get("/reports/:id/csv", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid report id" });
    }
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ message: "Report not found" });

    const safePath = resolveWithinDir(
      reportsRootDir(getUploadDir()),
      report.clientId,
      report.filename,
    );
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).json({ message: "Report file missing" });
    }

    const content = await fs.promises.readFile(safePath, "utf-8");
    const csv = reportJsonToCsv(content);
    const csvName = report.filename.replace(/\.json$/i, "") + ".csv";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${csvName}"`);
    res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to export report CSV" });
  }
});

// Command result file upload (encrypted)
router.post(
  "/commands/:id/result",
  uploadCommandResult.single("file"),
  async (req, res) => {
    const tempPath = req.file?.path;
    try {
      const id = req.params.id;
      if (!isSafeCommandId(id)) {
        return res.status(400).json({ message: "Invalid command id" });
      }
      const clientId =
        normalizeClientId(String((req as any).body?.clientId || "")) ||
        normalizeClientId(String(req.headers["x-client-id"] || "")) ||
        getSenderClientId(req);
      if (!req.file || !tempPath)
        return res.status(400).json({ message: "clientId and file required" });

      const now = authoritativeNow();
      const client: any = await getClient(clientId);

      if (!client || !client.encryptionKey) {
        return res
          .status(400)
          .json({ message: "Client not registered or missing key" });
      }

      const clientDir = path.join(getUploadDir(), "commands", clientId);
      fs.mkdirSync(clientDir, { recursive: true });
      const filename = `${id}_${Date.now()}_${randomUUID()}`;
      const filepath = path.join(clientDir, filename);

      try {
        await withLock(`file:${filepath}`, async () => {
          await decryptFileStream(tempPath, filepath, client.encryptionKey);
        });
      } catch {
        return res.status(400).json({ message: "Decryption failed" });
      }
      await saveClient({
        id: clientId,
        encryptionKey: client.encryptionKey,
        lastSeen: now,
      });

      res.json({ ok: true });
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
router.get("/commands/:id/file/latest", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!isSafeCommandId(id)) {
      return res.status(400).json({ message: "Invalid command id" });
    }
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
