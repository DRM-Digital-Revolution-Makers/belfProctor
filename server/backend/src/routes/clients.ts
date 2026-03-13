import { Router } from "express";
import path from "path";
import fs from "fs";
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

const router = Router();

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

router.put("/:id/category", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const category = String((req.body as any)?.category || "").trim();
    await saveClient({ id, category, updatedAt: new Date() });
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

  const startOfDay = new Date(dateStr);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);

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

        // Add to hourly stats
        const hour = timestamp.getHours();
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

router.get("/:id/monthly-summary", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const dateStr = req.query.date as string; // YYYY-MM

  if (!dateStr) {
    return res.status(400).json({ message: "Date required (YYYY-MM)" });
  }

  const [year, month] = dateStr.split("-").map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

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
