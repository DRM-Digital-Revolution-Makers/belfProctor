import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(clients);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const client = await prisma.client.findUnique({ where: { id } });
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
  const client = await prisma.client.upsert({
    where: { id },
    create: { id, encryptionKey },
    update: { encryptionKey },
  });
  res.json(client);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  try {
    await prisma.client.delete({ where: { id } });
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

  // 1. Calculate Activity Summary
  // Instead of summing (which is wrong for cumulative counters), we fetch all records and sum the deltas.
  const activityRecords = await prisma.activity.findMany({
    where: {
      clientId: id,
      timestamp: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      activeMilliseconds: true,
      inactiveMilliseconds: true,
    },
  });

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

      const hour = curr.timestamp.getHours();

      // Add positive deltas. If delta is negative, it means a counter reset (e.g. reboot),
      // so we add the current value as the new accumulated time.
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

  // Clamp to 24 hours (86400000 ms) to avoid impossible values
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  activeMs = Math.min(activeMs, ONE_DAY_MS);
  inactiveMs = Math.min(inactiveMs, ONE_DAY_MS - activeMs);

  // 2. Fetch Screenshots
  const screenshots = await prisma.screenshot.findMany({
    where: {
      clientId: id,
      timestamp: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    orderBy: { timestamp: "asc" },
    select: {
      id: true,
      timestamp: true,
      filename: true,
      isFavorite: true,
    },
  });

  // Distribute screenshots to hours
  screenshots.forEach((s) => {
    const hour = s.timestamp.getHours();
    if (hour >= 0 && hour < 24) {
      hourlyStats[hour].screenshotsCount++;
    }
  });

  res.json({
    date: dateStr,
    activeMs,
    inactiveMs,
    hourly: hourlyStats,
    screenshots: screenshots.map((s) => ({
      ...s,
      url: `/api/screenshots/${s.id}/file`,
    })),
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
  const activityRecords = await prisma.activity.findMany({
    where: {
      clientId: id,
      timestamp: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      activeMilliseconds: true,
      inactiveMilliseconds: true,
    },
  });

  // 2. Process daily activity
  const dailyActivity = new Map<
    string,
    { activeMs: number; inactiveMs: number }
  >();

  if (activityRecords.length > 0) {
    for (let i = 1; i < activityRecords.length; i++) {
      const prev = activityRecords[i - 1];
      const curr = activityRecords[i];

      // Check if same day
      const prevDay = prev.timestamp.toISOString().split("T")[0];
      const currDay = curr.timestamp.toISOString().split("T")[0];

      if (prevDay !== currDay) continue; // Skip boundary crossing for simplicity or handle strictly

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

  // 3. Fetch all screenshots for the month
  const screenshots = await prisma.screenshot.findMany({
    where: {
      clientId: id,
      timestamp: {
        gte: startOfMonth,
        lte: endOfMonth,
      },
    },
    select: {
      timestamp: true,
    },
  });

  const dailyScreenshots = new Map<string, number>();
  for (const s of screenshots) {
    const day = s.timestamp.toISOString().split("T")[0];
    dailyScreenshots.set(day, (dailyScreenshots.get(day) || 0) + 1);
  }

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

  res.json({
    month: dateStr,
    totalActiveMs,
    totalInactiveMs,
    totalScreenshots,
    days: resultDays,
  });
});

export default router;
