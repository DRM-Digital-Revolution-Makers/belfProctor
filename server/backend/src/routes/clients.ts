import { Router } from "express";
import path from "path";
import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AuthRequest, requireAuth } from "../middleware/auth";
import bcrypt from "bcryptjs";
import {
  getClients,
  getClient,
  saveClient,
  deleteClient,
  streamDailyActivitySummary,
  streamMonthlyActivitySummary,
  streamAppCounts,
  getTimesheetDataForMonth,
  getUser,
} from "../store";
import { requestClientUninstall } from "../wsHub";
import { resolveUploadDir } from "../runtimePaths";
import { prisma } from "../prisma";
import {
  startOfTashkentDay,
  endOfTashkentDay,
  tashkentHourOf,
  tashkentMinutesOfDay,
  tashkentDayKey,
} from "../tz";

const router = Router();

// Boundaries follow Asia/Tashkent (UTC+5) — a "day" on the dashboard means
// the user's local calendar day, not the server-container UTC day.
function dateRangeFromDay(dateStr: string): { start: Date; end: Date } {
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  return { start: startOfTashkentDay(anchor), end: endOfTashkentDay(anchor) };
}

function toNumberMs(value: unknown): number {
  return Number(value || 0);
}

function addMetric(
  map: Map<string, any>,
  key: string | null | undefined,
  session: any,
  labelKey: string,
): void {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  const current =
    map.get(normalized) ||
    {
      [labelKey]: normalized,
      openedMs: 0,
      focusedMs: 0,
      activeFocusedMs: 0,
      sessionsCount: 0,
    };
  current.openedMs += toNumberMs(session.openedMs);
  current.focusedMs += toNumberMs(session.focusedMs);
  current.activeFocusedMs += toNumberMs(session.activeFocusedMs);
  current.sessionsCount += 1;
  map.set(normalized, current);
}

function serializeWorkSession(session: any, screenshotsBySession?: Map<string, any[]>): any {
  return {
    ...session,
    openedMs: toNumberMs(session.openedMs),
    focusedMs: toNumberMs(session.focusedMs),
    activeFocusedMs: toNumberMs(session.activeFocusedMs),
    screenshots: screenshotsBySession?.get(session.id) || [],
  };
}

function parseScreenshotTimestamp(
  filename: string,
  filePath: string,
): Date | null {
  const match = filename.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+\.\d+Z)/);
  if (match) {
    const datePart = match[1].substring(0, 10);
    const timePart = match[1].substring(11).replace(/-/g, ":");
    const d = new Date(`${datePart}T${timePart}`);
    if (!isNaN(d.getTime())) return d;
  }
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

async function tryCompressToJpeg(
  bytes: Buffer,
  maxSide: number,
  quality: number,
): Promise<Buffer> {
  try {
    const m: any = await import("sharp");
    const sharpFn = m?.default || m;
    if (typeof sharpFn !== "function") return bytes;

    return await sharpFn(bytes)
      .rotate()
      .resize({
        width: maxSide,
        height: maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch {
    return bytes;
  }
}

router.get("/", requireAuth, async (req, res) => {
  const clients = await getClients();
  // Sort by createdAt desc
  clients.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  res.json(clients);
});

router.get("/reports/timesheet", requireAuth, async (req, res) => {
  const monthStr = (req.query.month as string) || "";
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return res.status(400).json({ message: "month required (YYYY-MM)" });
  }
  try {
    const data = await getTimesheetDataForMonth(monthStr);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to get timesheet data" });
  }
});

router.get("/categories", requireAuth, async (_req, res) => {
  try {
    const clients = await getClients();
    const set = new Set<string>();
    for (const c of clients) {
      const cat = String(c?.category || "").trim();
      if (cat) set.add(cat);
    }
    const categories = Array.from(set).sort();
    res.json({ categories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to list categories" });
  }
});

router.get("/:id/work-summary", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    // Default to today's calendar day in Asia/Tashkent so the dashboard matches
    // what the user sees on their own clock, not the server-container UTC day.
    const dateStr =
      String(req.query.date || "").trim() || tashkentDayKey(new Date());
    const { start, end } = dateRangeFromDay(dateStr);
    const sessions = await prisma.workSession.findMany({
      where: { clientId: id, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: "desc" },
      take: 2000,
    });
    const screenshots = await prisma.screenshot.findMany({
      where: {
        clientId: id,
        timestamp: { gte: start, lte: end },
        captureReason: { in: ["work_start", "work_switch", "work_end"] },
      },
      orderBy: { timestamp: "desc" },
      take: 500,
    });

    const totals = { openedMs: 0, focusedMs: 0, activeFocusedMs: 0 };
    const projects = new Map<string, any>();
    const files = new Map<string, any>();
    const folders = new Map<string, any>();
    const apps = new Map<string, any>();

    for (const session of sessions) {
      totals.openedMs += toNumberMs(session.openedMs);
      totals.focusedMs += toNumberMs(session.focusedMs);
      totals.activeFocusedMs += toNumberMs(session.activeFocusedMs);
      addMetric(projects, session.projectName || "unknown/external", session, "projectName");
      addMetric(files, session.filePath, session, "filePath");
      addMetric(folders, session.folderPath, session, "folderPath");
      addMetric(apps, session.processName, session, "processName");
    }

    const byActive = (a: any, b: any) => b.activeFocusedMs - a.activeFocusedMs;
    return res.json({
      date: dateStr,
      totals,
      projects: Array.from(projects.values()).sort(byActive),
      files: Array.from(files.values()).sort(byActive),
      folders: Array.from(folders.values()).sort(byActive),
      apps: Array.from(apps.values()).sort(byActive),
      screenshots: screenshots.map((s: any) => ({
        ...s,
        url: `/api/screenshots/${s.filename}/file`,
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Failed to get work summary" });
  }
});

router.get("/:id/work-sessions", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id);
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const sessions = await prisma.workSession.findMany({
      where: { clientId: id, startedAt: { gte: from, lte: to } },
      orderBy: { startedAt: "desc" },
      take: 1000,
    });
    const sessionIds = sessions.map((s: any) => s.id);
    const screenshots =
      sessionIds.length > 0
        ? await prisma.screenshot.findMany({
            where: { linkedSessionId: { in: sessionIds } },
            orderBy: { timestamp: "asc" },
          })
        : [];
    const screenshotsBySession = new Map<string, any[]>();
    for (const shot of screenshots) {
      const sid = String(shot.linkedSessionId || "");
      if (!sid) continue;
      const arr = screenshotsBySession.get(sid) || [];
      arr.push({ ...shot, url: `/api/screenshots/${shot.filename}/file` });
      screenshotsBySession.set(sid, arr);
    }

    const data = sessions.map((session: any) =>
      serializeWorkSession(session, screenshotsBySession),
    );
    res.json({ data, total: data.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to get work sessions" });
  }
});

router.put("/:id/category", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const category = String((req.body as any)?.category || "").trim();
    await saveClient({ id, category });
    res.json(await getClient(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to set category" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const client = await getClient(id);
  if (!client) return res.status(404).json({ message: "Not found" });
  res.json(client);
});

// Optional: register client with encryption key
router.post("/register", requireAuth, async (req, res) => {
  const { id, encryptionKey } = req.body as {
    id: string;
    encryptionKey: string;
  };
  if (!id || !encryptionKey)
    return res.status(400).json({ message: "id and encryptionKey required" });

  await saveClient({ id, encryptionKey });
  res.json(await getClient(id));
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  try {
    if (!req.user || req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const password =
      String((req.body as any)?.password || "").trim() ||
      String(req.headers["x-admin-password"] || "").trim();
    if (!password) {
      return res.status(400).json({ message: "Password required" });
    }

    const user = await getUser(req.user.email);
    if (!user)
      return res.status(500).json({ message: "User record not found" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(403).json({ message: "Invalid password" });

    const uninstall = await requestClientUninstall(id, {
      serviceName: "BelfProctor",
    });
    await deleteClient(id);
    res.json({ ok: true, uninstall });
  } catch (e) {
    res.status(404).json({ message: "Not found" });
  }
});

router.get("/:id/daily-summary", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const dateStr = req.query.date as string;

  if (!dateStr) {
    return res.status(400).json({ message: "Date required (YYYY-MM-DD)" });
  }

  const { start: startOfDay, end: endOfDay } = dateRangeFromDay(dateStr);

  // 1. Activity: stream + compute aggregates (no arrays, CPU-bound)
  const {
    activeMs,
    inactiveMs,
    hourly: hourlyStats,
  } = await streamDailyActivitySummary(id, startOfDay, endOfDay);

  // 2. Screenshots (one dir scan, no heavy alloc)
  const screenshots: any[] = [];
  const screenshotsDir = path.join(resolveUploadDir(), "screenshots", id);
  if (fs.existsSync(screenshotsDir)) {
    const files = fs.readdirSync(screenshotsDir);
    for (const f of files) {
      if (!f.endsWith(".jpg") && !f.endsWith(".png")) continue;

      let timestamp: Date | null = null;
      // Parse filename: CLIENT02_2025-12-21T16-04-48.694Z.jpg
      const match = f.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+\.\d+Z)/);
      if (match) {
        const datePart = match[1].substring(0, 10);
        const timePart = match[1].substring(11).replace(/-/g, ":");
        const validIso = `${datePart}T${timePart}`;
        const d = new Date(validIso);
        if (!isNaN(d.getTime())) timestamp = d;
      } else {
        // Fallback to mtime if name parse fails
        const stats = fs.statSync(path.join(screenshotsDir, f));
        timestamp = stats.mtime;
      }

      if (timestamp && timestamp >= startOfDay && timestamp <= endOfDay) {
        screenshots.push({
          id: f,
          filename: f,
          timestamp: timestamp,
          isFavorite: false,
          url: `/api/screenshots/${f}/file`,
        });

        // Add to hourly stats (Tashkent-anchored — matches the dashboard's day boundary)
        const hour = tashkentHourOf(timestamp);
        if (hour >= 0 && hour < 24) {
          hourlyStats[hour].screenshotsCount++;
        }
      }
    }
  }
  screenshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // 3. Top 5 Apps: stream events, count only (no event array)
  const topApps = await streamAppCounts(id, startOfDay, endOfDay);

  res.json({
    date: dateStr,
    activeMs,
    inactiveMs,
    hourly: hourlyStats,
    topApps,
    screenshots,
  });
});

router.get("/:id/screenshots/pdf", requireAuth, async (req, res) => {
  const id = String(req.params.id || "");
  const fromStr = String(req.query.from || "").trim();
  const toStr = String(req.query.to || "").trim() || fromStr;
  const startTimeStr = String(req.query.startTime || "").trim();
  const endTimeStr = String(req.query.endTime || "").trim();
  const maxSideRaw = parseInt(String(req.query.maxSide || "1280"), 10);
  const qualityRaw = parseInt(String(req.query.quality || "70"), 10);
  const maxSide = Number.isFinite(maxSideRaw)
    ? Math.max(320, Math.min(4096, maxSideRaw))
    : 1280;
  const quality = Number.isFinite(qualityRaw)
    ? Math.max(30, Math.min(90, qualityRaw))
    : 70;

  const fromMatch = fromStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = toStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fromMatch || !toMatch) {
    return res.status(400).json({ message: "from/to required (YYYY-MM-DD)" });
  }

  const { start: startOfRange } = dateRangeFromDay(fromStr);
  const { end: endOfRange } = dateRangeFromDay(toStr);

  let startMinutes: number | null = null;
  let endMinutes: number | null = null;
  if (startTimeStr || endTimeStr) {
    const m1 = startTimeStr.match(/^(\d{2}):(\d{2})$/);
    const m2 = endTimeStr.match(/^(\d{2}):(\d{2})$/);
    if (!m1 || !m2) {
      return res
        .status(400)
        .json({ message: "startTime/endTime must be HH:mm" });
    }
    const h1 = parseInt(m1[1], 10);
    const min1 = parseInt(m1[2], 10);
    const h2 = parseInt(m2[1], 10);
    const min2 = parseInt(m2[2], 10);
    if (
      h1 < 0 ||
      h1 > 23 ||
      h2 < 0 ||
      h2 > 23 ||
      min1 < 0 ||
      min1 > 59 ||
      min2 < 0 ||
      min2 > 59
    ) {
      return res.status(400).json({ message: "Invalid time range" });
    }
    startMinutes = h1 * 60 + min1;
    endMinutes = h2 * 60 + min2;
    if (endMinutes < startMinutes) {
      return res.status(400).json({ message: "endTime must be >= startTime" });
    }
  }

  try {
    const screenshotsDir = path.join(resolveUploadDir(), "screenshots", id);
    if (!fs.existsSync(screenshotsDir)) {
      return res.status(404).json({ message: "No screenshots" });
    }

    const files = fs
      .readdirSync(screenshotsDir)
      .filter((f) => f.endsWith(".jpg") || f.endsWith(".png"));

    const selected: { filename: string; filePath: string; timestamp: Date }[] =
      [];

    for (const filename of files) {
      const filePath = path.join(screenshotsDir, filename);
      const ts = parseScreenshotTimestamp(filename, filePath);
      if (!ts) continue;
      if (ts < startOfRange || ts > endOfRange) continue;

      if (startMinutes !== null && endMinutes !== null) {
        const mins = tashkentMinutesOfDay(ts);
        if (mins < startMinutes || mins > endMinutes) continue;
      }

      selected.push({ filename, filePath, timestamp: ts });
    }

    if (selected.length === 0) {
      return res.status(404).json({ message: "No screenshots" });
    }

    selected.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const item of selected) {
      const bytes = fs.readFileSync(item.filePath);
      const embedBytes = await tryCompressToJpeg(bytes, maxSide, quality);
      const img = await pdfDoc.embedJpg(embedBytes);

      const page = pdfDoc.addPage([842, 595]);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const margin = 24;
      const captionH = 18;

      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2 - captionH;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);

      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const x = (pageWidth - drawW) / 2;
      const y = margin + captionH + (maxH - drawH) / 2;

      page.drawImage(img, { x, y, width: drawW, height: drawH });

      const tsText = item.timestamp
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      const caption = `${tsText}  ${item.filename}`;
      page.drawText(caption, {
        x: margin,
        y: margin,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const safeFrom = fromStr.replace(/[^\d-]/g, "");
    const safeTo = toStr.replace(/[^\d-]/g, "");
    const filename = `screenshots_${id}_${safeFrom}_${safeTo}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
});

router.get("/:id/monthly-summary", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const dateStr = req.query.date as string; // YYYY-MM

  if (!dateStr) {
    return res.status(400).json({ message: "Date required (YYYY-MM)" });
  }

  const [year, month] = dateStr.split("-").map(Number);
  // Month boundaries follow Asia/Tashkent: the first day's 00:00 in Tashkent
  // through the last day's 23:59 in Tashkent.
  const firstDayStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDayStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const { start: startOfMonth } = dateRangeFromDay(firstDayStr);
  const { end: endOfMonth } = dateRangeFromDay(lastDayStr);

  // 1. Activity: stream + compute daily aggregates (no arrays)
  const { dailyActivity, totalActiveMs, totalInactiveMs } =
    await streamMonthlyActivitySummary(id, startOfMonth, endOfMonth);

  // 2. Build days array (dailyActivity already clamped by stream)
  const daysInMonth = endOfMonth.getDate();
  const resultDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dateKey = date.toISOString().split("T")[0];
    const act = dailyActivity.get(dateKey) || { activeMs: 0, inactiveMs: 0 };
    resultDays.push({
      date: dateKey,
      activeMs: act.activeMs,
      inactiveMs: act.inactiveMs,
      screenshotsCount: 0,
    });
  }

  // 3. Top 5 Apps: stream, count only (no event array)
  const topApps = await streamAppCounts(id, startOfMonth, endOfMonth);

  res.json({
    month: dateStr,
    totalActiveMs,
    totalInactiveMs,
    totalScreenshots: 0,
    days: resultDays,
    topApps,
  });
});

export default router;
