import fsPromises from "fs/promises";
import { SystemEventType } from "@prisma/client";
import { prisma } from "./prisma";

function parseDays(envName: string, fallback: number): number {
  const v = Number.parseInt(String(process.env[envName] || ""), 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function cutoffDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const SCREENSHOT_DELETE_BATCH = 500;

async function deleteOldScreenshots(cutoff: Date): Promise<number> {
  let totalDeleted = 0;
  while (true) {
    const batch = await prisma.screenshot.findMany({
      where: { timestamp: { lt: cutoff } },
      select: { id: true, path: true },
      take: SCREENSHOT_DELETE_BATCH,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      if (row.path) {
        await fsPromises.unlink(row.path).catch(() => undefined);
      }
    }

    const ids = batch.map((r) => r.id);
    const result = await prisma.screenshot.deleteMany({
      where: { id: { in: ids } },
    });
    totalDeleted += result.count;

    if (batch.length < SCREENSHOT_DELETE_BATCH) break;
  }
  return totalDeleted;
}

export async function runRetentionOnce(): Promise<{
  screenshotsDeleted: number;
  activityRemoved: number;
  eventsRemoved: number;
  heartbeatsRemoved: number;
  commandResultsRemoved: number;
}> {
  const screenshotsCutoff = cutoffDate(
    parseDays("RETENTION_SCREENSHOTS_DAYS", 30),
  );
  const activityCutoff = cutoffDate(parseDays("RETENTION_ACTIVITY_DAYS", 30));
  const heartbeatCutoff = cutoffDate(parseDays("RETENTION_HEARTBEAT_DAYS", 2));
  const commandsCutoff = cutoffDate(parseDays("RETENTION_COMMANDS_DAYS", 7));
  const appCutoff = cutoffDate(parseDays("RETENTION_APP_HISTORY_DAYS", 30));

  const screenshotsDeleted = await deleteOldScreenshots(screenshotsCutoff);

  const [activityResult, eventsResult, heartbeatsResult, commandResultsResult] =
    await prisma.$transaction([
      prisma.activity.deleteMany({
        where: { timestamp: { lt: activityCutoff } },
      }),
      prisma.event.deleteMany({
        where: {
          eventType: SystemEventType.AppUsage,
          timestamp: { lt: appCutoff },
        },
      }),
      prisma.heartbeat.deleteMany({
        where: { timestamp: { lt: heartbeatCutoff } },
      }),
      prisma.commandResult.deleteMany({
        where: { receivedAt: { lt: commandsCutoff } },
      }),
    ]);

  return {
    screenshotsDeleted,
    activityRemoved: activityResult.count,
    eventsRemoved: eventsResult.count,
    heartbeatsRemoved: heartbeatsResult.count,
    commandResultsRemoved: commandResultsResult.count,
  };
}
