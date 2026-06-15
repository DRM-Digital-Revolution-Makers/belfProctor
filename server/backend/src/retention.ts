import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { SystemEventType } from "@prisma/client";
import { prisma } from "./prisma";
import { config } from "./config";

/**
 * Data retention sweep. Each concern is isolated in its own try/catch so a
 * single failure (e.g. a locked file) does not abort the whole sweep — the
 * remaining tables/files are still cleaned and every error is logged.
 *
 * File-backed data (screenshots, reports) is deleted in batches so the file
 * unlinks and the row deletes stay in lock-step; pure-DB tables use a single
 * deleteMany (atomic in Postgres).
 */

function cutoffDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const FILE_DELETE_BATCH = 500;

export interface RetentionSummary {
  screenshotsDeleted: number;
  reportsDeleted: number;
  activityRemoved: number;
  eventsRemoved: number;
  appUsageEventsRemoved: number;
  appUsageRowsRemoved: number;
  heartbeatsRemoved: number;
  commandResultsRemoved: number;
  browserActivityRemoved: number;
  workSessionsRemoved: number;
  workSessionEventsRemoved: number;
  pcSessionsRemoved: number;
  timesheetDaysRemoved: number;
  agentVersionsRemoved: number;
  logFilesRemoved: number;
  errors: string[];
}

async function deleteOldScreenshots(cutoff: Date): Promise<number> {
  let total = 0;
  // Loop in batches: fetch rows, unlink their files, delete the rows.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.screenshot.findMany({
      where: { timestamp: { lt: cutoff } },
      select: { id: true, path: true },
      take: FILE_DELETE_BATCH,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      if (row.path) await fsPromises.unlink(row.path).catch(() => undefined);
    }
    const result = await prisma.screenshot.deleteMany({
      where: { id: { in: batch.map((r) => r.id) } },
    });
    total += result.count;
    if (batch.length < FILE_DELETE_BATCH) break;
  }
  return total;
}

async function deleteOldReports(cutoff: Date): Promise<number> {
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.report.findMany({
      where: { timestamp: { lt: cutoff } },
      select: { id: true, path: true },
      take: FILE_DELETE_BATCH,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      if (row.path) await fsPromises.unlink(row.path).catch(() => undefined);
    }
    const result = await prisma.report.deleteMany({
      where: { id: { in: batch.map((r) => r.id) } },
    });
    total += result.count;
    if (batch.length < FILE_DELETE_BATCH) break;
  }
  return total;
}

/** Recursively delete files older than `cutoff` under `dir`. Returns count. */
export async function deleteOldFilesRecursive(
  dir: string,
  cutoff: Date,
): Promise<number> {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await deleteOldFilesRecursive(full, cutoff);
    } else if (entry.isFile()) {
      try {
        const stat = await fsPromises.stat(full);
        if (stat.mtime < cutoff) {
          await fsPromises.unlink(full);
          removed++;
        }
      } catch {
        // File vanished or is locked — skip it, try again next sweep.
      }
    }
  }
  return removed;
}

/** Keep the newest N agent versions; delete older rows and their binaries. */
async function pruneAgentVersions(keep: number): Promise<number> {
  const versions = await prisma.agentVersion.findMany({
    orderBy: { uploadedAt: "desc" },
    select: { version: true },
  });
  if (versions.length <= keep) return 0;

  const toDelete = versions.slice(keep).map((v) => v.version);
  const updatesDir = path.join(config.uploadDir, "updates");
  for (const version of toDelete) {
    const dir = path.join(updatesDir, version);
    await fsPromises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  // Cascade removes the related UpdateDeployment rows (schema onDelete: Cascade).
  const result = await prisma.agentVersion.deleteMany({
    where: { version: { in: toDelete } },
  });
  return result.count;
}

export async function runRetentionOnce(): Promise<RetentionSummary> {
  const r = config.retention;
  const summary: RetentionSummary = {
    screenshotsDeleted: 0,
    reportsDeleted: 0,
    activityRemoved: 0,
    eventsRemoved: 0,
    appUsageEventsRemoved: 0,
    appUsageRowsRemoved: 0,
    heartbeatsRemoved: 0,
    commandResultsRemoved: 0,
    browserActivityRemoved: 0,
    workSessionsRemoved: 0,
    workSessionEventsRemoved: 0,
    pcSessionsRemoved: 0,
    timesheetDaysRemoved: 0,
    agentVersionsRemoved: 0,
    logFilesRemoved: 0,
    errors: [],
  };

  // Run each concern independently; record but never propagate failures so one
  // bad section cannot block the rest of the sweep.
  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const msg = `${label}: ${e instanceof Error ? e.message : String(e)}`;
      summary.errors.push(msg);
      console.error(`[Retention] ${msg}`);
    }
  };

  await run("screenshots", async () => {
    summary.screenshotsDeleted = await deleteOldScreenshots(
      cutoffDate(r.screenshotsDays),
    );
  });

  await run("reports", async () => {
    summary.reportsDeleted = await deleteOldReports(cutoffDate(r.reportsDays));
  });

  await run("activity", async () => {
    summary.activityRemoved = (
      await prisma.activity.deleteMany({
        where: { timestamp: { lt: cutoffDate(r.activityDays) } },
      })
    ).count;
  });

  await run("events", async () => {
    // Non-AppUsage events expire on the general events schedule...
    summary.eventsRemoved = (
      await prisma.event.deleteMany({
        where: {
          eventType: { not: SystemEventType.AppUsage },
          timestamp: { lt: cutoffDate(r.eventsDays) },
        },
      })
    ).count;
    // ...AppUsage-typed events on the app-history schedule (kept separate so the
    // two can be tuned independently).
    summary.appUsageEventsRemoved = (
      await prisma.event.deleteMany({
        where: {
          eventType: SystemEventType.AppUsage,
          timestamp: { lt: cutoffDate(r.appHistoryDays) },
        },
      })
    ).count;
  });

  await run("appUsage", async () => {
    summary.appUsageRowsRemoved = (
      await prisma.appUsage.deleteMany({
        where: { lastSeen: { lt: cutoffDate(r.appHistoryDays) } },
      })
    ).count;
  });

  await run("heartbeats", async () => {
    summary.heartbeatsRemoved = (
      await prisma.heartbeat.deleteMany({
        where: { timestamp: { lt: cutoffDate(r.heartbeatDays) } },
      })
    ).count;
  });

  await run("commandResults", async () => {
    summary.commandResultsRemoved = (
      await prisma.commandResult.deleteMany({
        where: { receivedAt: { lt: cutoffDate(r.commandsDays) } },
      })
    ).count;
  });

  await run("browserActivity", async () => {
    summary.browserActivityRemoved = (
      await prisma.browserActivity.deleteMany({
        where: { visitedAt: { lt: cutoffDate(r.browserDays) } },
      })
    ).count;
  });

  await run("workSessionEvents", async () => {
    summary.workSessionEventsRemoved = (
      await prisma.workSessionEvent.deleteMany({
        where: { timestampUtc: { lt: cutoffDate(r.workSessionsDays) } },
      })
    ).count;
  });

  await run("workSessions", async () => {
    summary.workSessionsRemoved = (
      await prisma.workSession.deleteMany({
        where: { startedAt: { lt: cutoffDate(r.workSessionsDays) } },
      })
    ).count;
  });

  await run("pcSessions", async () => {
    summary.pcSessionsRemoved = (
      await prisma.pcSession.deleteMany({
        where: { bootAt: { lt: cutoffDate(r.pcSessionsDays) } },
      })
    ).count;
  });

  await run("timesheetDays", async () => {
    summary.timesheetDaysRemoved = (
      await prisma.timesheetDay.deleteMany({
        where: { date: { lt: cutoffDate(r.timesheetDays) } },
      })
    ).count;
  });

  await run("agentVersions", async () => {
    summary.agentVersionsRemoved = await pruneAgentVersions(r.agentVersionsKeep);
  });

  await run("logFiles", async () => {
    const logsRoot = path.join(config.uploadDir, "logs");
    let removed = 0;
    removed += await deleteOldFilesRecursive(
      path.join(logsRoot, "server"),
      cutoffDate(r.serverLogsDays),
    );
    removed += await deleteOldFilesRecursive(
      path.join(logsRoot, "clients"),
      cutoffDate(r.clientLogsDays),
    );
    summary.logFilesRemoved = removed;
  });

  return summary;
}
