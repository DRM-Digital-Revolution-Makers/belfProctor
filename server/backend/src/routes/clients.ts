import { Router } from "express";
import path from "path";
import fs from "fs";
import { requireAuth } from "../middleware/auth";
import {
  getClients,
  getClient,
  saveClient,
  deleteClient,
  getClientActivity,
  getClientEvents,
} from "../store";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const clients = getClients();
  // Sort by createdAt desc
  clients.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(clients);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const client = getClient(id);
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

  saveClient({ id, encryptionKey });
  res.json(getClient(id));
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  try {
    deleteClient(id);
    res.json({ ok: true });
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

  // 1. Calculate Activity Summary from file
  const allActivity = getClientActivity(id);
  const activityRecords = allActivity.filter((r) => {
    const t = new Date(r.timestamp);
    return t >= startOfDay && t <= endOfDay;
  });
  // Sort asc
  activityRecords.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let activeMs = 0;
  let inactiveMs = 0;
  const hourlyStats = new Array(24).fill(0).map((_, i) => ({
    hour: i,
    activeMs: 0,
    inactiveMs: 0,
    screenshotsCount: 0,
  }));

  if (activityRecords.length > 0) {
    for (let i = 1; i < activityRecords.length; i++) {
      const prev = activityRecords[i - 1];
      const curr = activityRecords[i];

      const dActive = curr.activeMilliseconds - prev.activeMilliseconds;
      const dInactive = curr.inactiveMilliseconds - prev.inactiveMilliseconds;

      const hour = new Date(curr.timestamp).getHours();

      let addActive = 0;
      let addInactive = 0;

      if (dActive >= 0) {
        addActive = dActive;
      } else {
        addActive = curr.activeMilliseconds;
      }

      if (dInactive >= 0) {
        addInactive = dInactive;
      } else {
        addInactive = curr.inactiveMilliseconds;
      }

      activeMs += addActive;
      inactiveMs += addInactive;

      if (hour >= 0 && hour < 24) {
        hourlyStats[hour].activeMs += addActive;
        hourlyStats[hour].inactiveMs += addInactive;
      }
    }
  }

  // Clamp to 24 hours
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  activeMs = Math.min(activeMs, ONE_DAY_MS);
  inactiveMs = Math.min(inactiveMs, ONE_DAY_MS - activeMs);

  // 2. Fetch Screenshots (from file system)
  const screenshots: any[] = [];
  const screenshotsDir = path.join(process.cwd(), "storage", "screenshots", id);
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
  // Sort screenshots by time desc
  screenshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // 3. Fetch Top 5 Apps (from events file)
  const allEvents = getClientEvents(id);
  const appEvents = allEvents.filter((e) => {
    const t = new Date(e.timestamp);
    return e.eventType === "AppUsage" && t >= startOfDay && t <= endOfDay;
  });

  const appCounts: Record<string, number> = {};
  appEvents.forEach((e) => {
    const name = e.processName || "Unknown";
    appCounts[name] = (appCounts[name] || 0) + 1;
  });

  const topApps = Object.entries(appCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

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

  // 1. Fetch all activity records for the month
  const allActivity = getClientActivity(id);
  const activityRecords = allActivity.filter((r) => {
    const t = new Date(r.timestamp);
    return t >= startOfMonth && t <= endOfMonth;
  });
  activityRecords.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // 2. Process daily activity
  const dailyActivity = new Map<
    string,
    { activeMs: number; inactiveMs: number }
  >();

  if (activityRecords.length > 0) {
    for (let i = 1; i < activityRecords.length; i++) {
      const prev = activityRecords[i - 1];
      const curr = activityRecords[i];

      const prevDate = new Date(prev.timestamp);
      const currDate = new Date(curr.timestamp);

      // Check if same day
      const prevDay = prevDate.toISOString().split("T")[0];
      const currDay = currDate.toISOString().split("T")[0];

      if (prevDay !== currDay) continue;

      const dActive = curr.activeMilliseconds - prev.activeMilliseconds;
      const dInactive = curr.inactiveMilliseconds - prev.inactiveMilliseconds;

      let activeToAdd = 0;
      let inactiveToAdd = 0;

      if (dActive >= 0) activeToAdd = dActive;
      else activeToAdd = curr.activeMilliseconds;

      if (dInactive >= 0) inactiveToAdd = dInactive;
      else inactiveToAdd = curr.inactiveMilliseconds;

      const dayStats = dailyActivity.get(currDay) || {
        activeMs: 0,
        inactiveMs: 0,
      };
      dayStats.activeMs += activeToAdd;
      dayStats.inactiveMs += inactiveToAdd;
      dailyActivity.set(currDay, dayStats);
    }
  }

  // 3. Screenshots (empty)
  const dailyScreenshots = new Map<string, number>();

  // 4. Combine into daily list
  const daysInMonth = endOfMonth.getDate();
  const resultDays = [];
  let totalActiveMs = 0;
  let totalInactiveMs = 0;
  let totalScreenshots = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dateKey = date.toISOString().split("T")[0];

    const act = dailyActivity.get(dateKey) || { activeMs: 0, inactiveMs: 0 };
    const scCount = dailyScreenshots.get(dateKey) || 0;

    // Clamp daily
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    act.activeMs = Math.min(act.activeMs, ONE_DAY_MS);
    act.inactiveMs = Math.min(act.inactiveMs, ONE_DAY_MS - act.activeMs);

    totalActiveMs += act.activeMs;
    totalInactiveMs += act.inactiveMs;
    totalScreenshots += scCount;

    resultDays.push({
      date: dateKey,
      activeMs: act.activeMs,
      inactiveMs: act.inactiveMs,
      screenshotsCount: scCount,
    });
  }

  // 5. Fetch Top 5 Apps for the month
  const allEvents = getClientEvents(id);
  const appEvents = allEvents.filter((e) => {
    const t = new Date(e.timestamp);
    return e.eventType === "AppUsage" && t >= startOfMonth && t <= endOfMonth;
  });

  const appCounts: Record<string, number> = {};
  appEvents.forEach((e) => {
    const name = e.processName || "Unknown";
    appCounts[name] = (appCounts[name] || 0) + 1;
  });

  const topApps = Object.entries(appCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    month: dateStr,
    totalActiveMs,
    totalInactiveMs,
    totalScreenshots,
    days: resultDays,
    topApps,
  });
});

export default router;
