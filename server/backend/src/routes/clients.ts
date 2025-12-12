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
      activeMilliseconds: true,
      inactiveMilliseconds: true,
    },
  });

  let activeMs = 0;
  let inactiveMs = 0;

  if (activityRecords.length > 0) {
    for (let i = 1; i < activityRecords.length; i++) {
      const prev = activityRecords[i - 1];
      const curr = activityRecords[i];

      const dActive = curr.activeMilliseconds - prev.activeMilliseconds;
      const dInactive = curr.inactiveMilliseconds - prev.inactiveMilliseconds;

      // Add positive deltas. If delta is negative, it means a counter reset (e.g. reboot),
      // so we add the current value as the new accumulated time.
      if (dActive >= 0) {
        activeMs += dActive;
      } else {
        activeMs += curr.activeMilliseconds;
      }

      if (dInactive >= 0) {
        inactiveMs += dInactive;
      } else {
        inactiveMs += curr.inactiveMilliseconds;
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

  res.json({
    date: dateStr,
    activeMs,
    inactiveMs,
    screenshots: screenshots.map((s) => ({
      ...s,
      url: `/api/screenshots/${s.id}/file`,
    })),
  });
});

export default router;
