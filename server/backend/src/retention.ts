import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import readline from "readline";
import { withLock } from "./locks";
import { resolveUploadDir } from "./runtimePaths";

const DATA_DIR = resolveUploadDir();

function daysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}

function parseDays(envName: string, fallback: number): number {
  const v = Number.parseInt(String(process.env[envName] || ""), 10);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function ensureDir(p: string): Promise<void> {
  await fsPromises.mkdir(p, { recursive: true });
}

async function atomicReplaceFile(
  tmpPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await fsPromises.rename(tmpPath, targetPath);
  } catch {
    try {
      await fsPromises.unlink(targetPath);
    } catch {}
    await fsPromises.rename(tmpPath, targetPath);
  }
}

function tryParseEventTimestamp(obj: any): Date | null {
  const raw = obj?.timestamp || obj?.Timestamp || obj?.time || obj?.Time;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

async function pruneJsonlFile(
  filePath: string,
  keepLine: (obj: any) => boolean,
): Promise<{ kept: number; removed: number }> {
  if (!fs.existsSync(filePath)) return { kept: 0, removed: 0 };
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.tmp_${process.pid}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`,
  );

  let kept = 0;
  let removed = 0;

  await ensureDir(dir);
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out = fs.createWriteStream(tmpPath, { encoding: "utf8" });

  await new Promise<void>((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const obj = JSON.parse(trimmed);
        if (keepLine(obj)) {
          out.write(trimmed + "\n");
          kept++;
        } else {
          removed++;
        }
      } catch {
        removed++;
      }
    });
    rl.on("close", resolve);
    rl.on("error", reject);
    input.on("error", reject);
  });

  await new Promise<void>((resolve) => out.end(resolve));

  if (kept === 0) {
    try {
      await fsPromises.unlink(filePath);
    } catch {}
    try {
      await fsPromises.unlink(tmpPath);
    } catch {}
    return { kept: 0, removed };
  }

  await atomicReplaceFile(tmpPath, filePath);
  return { kept, removed };
}

async function cleanupScreenshots(cutoffMs: number): Promise<number> {
  const root = path.join(DATA_DIR, "screenshots");
  if (!fs.existsSync(root)) return 0;
  let deleted = 0;
  const clientDirs = await fsPromises.readdir(root);
  for (const clientId of clientDirs) {
    const dir = path.join(root, clientId);
    let st: fs.Stats;
    try {
      st = await fsPromises.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[] = [];
    try {
      files = await fsPromises.readdir(dir);
    } catch {
      continue;
    }

    for (const f of files) {
      if (!f.endsWith(".jpg") && !f.endsWith(".png")) continue;
      const fp = path.join(dir, f);
      let ts: Date | null = null;
      const match = f.match(/_(\d{4}-\d{2}-\d{2}T[\d-]+\.\d+Z)/);
      if (match) {
        const datePart = match[1].substring(0, 10);
        const timePart = match[1].substring(11).replace(/-/g, ":");
        const d = new Date(`${datePart}T${timePart}`);
        if (!isNaN(d.getTime())) ts = d;
      }
      if (!ts) {
        try {
          const st2 = await fsPromises.stat(fp);
          ts = st2.mtime;
        } catch {
          ts = null;
        }
      }
      if (!ts) continue;
      if (ts.getTime() < cutoffMs) {
        try {
          await fsPromises.unlink(fp);
          deleted++;
        } catch {}
      }
    }
  }
  return deleted;
}

function tryParseTrailingEpochMs(filename: string): number | null {
  const name = String(filename || "");
  const m1 = name.match(/_(\d+)\.json$/);
  if (m1) {
    const n = Number.parseInt(m1[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  const m2 = name.match(/_(\d+)$/);
  if (m2) {
    const n = Number.parseInt(m2[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function cleanupCommands(cutoffMs: number): Promise<number> {
  const root = path.join(DATA_DIR, "commands");
  if (!fs.existsSync(root)) return 0;
  let deleted = 0;
  const clientDirs = await fsPromises.readdir(root);
  for (const clientId of clientDirs) {
    const dir = path.join(root, clientId);
    let st: fs.Stats;
    try {
      st = await fsPromises.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let files: string[] = [];
    try {
      files = await fsPromises.readdir(dir);
    } catch {
      continue;
    }

    for (const f of files) {
      const fp = path.join(dir, f);
      const tsFromName = tryParseTrailingEpochMs(f);
      let mtimeMs = 0;
      try {
        const st2 = await fsPromises.stat(fp);
        mtimeMs = st2.mtimeMs;
      } catch {
        continue;
      }
      const ts = tsFromName ?? mtimeMs;
      if (ts < cutoffMs) {
        await withLock(`file:${fp}`, async () => {
          try {
            await fsPromises.unlink(fp);
            deleted++;
          } catch {}
        });
      }
    }

    try {
      const remaining = await fsPromises.readdir(dir);
      if (remaining.length === 0) {
        await fsPromises.rmdir(dir);
      }
    } catch {}
  }
  return deleted;
}

async function cleanupCommandIndex(cutoffMs: number): Promise<number> {
  const dir = path.join(DATA_DIR, "command_index");
  if (!fs.existsSync(dir)) return 0;
  let deleted = 0;
  let files: string[] = [];
  try {
    files = await fsPromises.readdir(dir);
  } catch {
    return 0;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const fp = path.join(dir, f);
    await withLock(`file:${fp}`, async () => {
      try {
        const st = await fsPromises.stat(fp);
        const raw = await fsPromises.readFile(fp, "utf-8");
        const obj = JSON.parse(raw);
        const latestPath = String(obj?.latestPath || "").trim();
        const updatedAt = new Date(String(obj?.updatedAt || "")).getTime();
        const indexTs =
          Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : st.mtimeMs;

        let latestOk = false;
        let latestTs = 0;
        if (latestPath && fs.existsSync(latestPath)) {
          try {
            const st2 = await fsPromises.stat(latestPath);
            latestOk = true;
            latestTs = st2.mtimeMs;
          } catch {
            latestOk = false;
          }
        }

        if (!latestOk || Math.max(indexTs, latestTs) < cutoffMs) {
          await fsPromises.unlink(fp);
          deleted++;
        }
      } catch {
        try {
          await fsPromises.unlink(fp);
          deleted++;
        } catch {}
      }
    });
  }
  return deleted;
}

export async function runRetentionOnce(): Promise<{
  screenshotsDeleted: number;
  activityRemoved: number;
  eventsRemoved: number;
  heartbeatsRemoved: number;
}> {
  const screenshotsDays = parseDays("RETENTION_SCREENSHOTS_DAYS", 30);
  const appHistoryDays = parseDays("RETENTION_APP_HISTORY_DAYS", 30);
  const activityDays = parseDays("RETENTION_ACTIVITY_DAYS", 30);
  const heartbeatDays = parseDays("RETENTION_HEARTBEAT_DAYS", 2);
  const commandsDays = parseDays("RETENTION_COMMANDS_DAYS", 7);

  const now = Date.now();
  const screenshotsCutoff = now - daysToMs(screenshotsDays);
  const appCutoff = now - daysToMs(appHistoryDays);
  const activityCutoff = now - daysToMs(activityDays);
  const heartbeatCutoff = now - daysToMs(heartbeatDays);
  const commandsCutoff = now - daysToMs(commandsDays);

  const screenshotsDeleted = await cleanupScreenshots(screenshotsCutoff);
  await cleanupCommands(commandsCutoff);
  await cleanupCommandIndex(commandsCutoff);

  const activityDir = path.join(DATA_DIR, "activity");
  let activityRemoved = 0;
  if (fs.existsSync(activityDir)) {
    const files = await fsPromises.readdir(activityDir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(activityDir, f);
      let res = { kept: 0, removed: 0 };
      await withLock(`file:${fp}`, async () => {
        res = await pruneJsonlFile(fp, (obj) => {
          const ts = tryParseEventTimestamp(obj);
          if (!ts) return false;
          return ts.getTime() >= activityCutoff;
        });
      });
      activityRemoved += res.removed;
    }
  }

  const eventsDir = path.join(DATA_DIR, "events");
  let eventsRemoved = 0;
  if (fs.existsSync(eventsDir)) {
    const files = await fsPromises.readdir(eventsDir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(eventsDir, f);
      let res = { kept: 0, removed: 0 };
      await withLock(`file:${fp}`, async () => {
        res = await pruneJsonlFile(fp, (obj) => {
          const ts = tryParseEventTimestamp(obj);
          if (!ts) return false;
          const type = String(obj?.eventType || obj?.EventType || "");
          if (type !== "AppUsage") return false;
          return ts.getTime() >= appCutoff;
        });
      });
      eventsRemoved += res.removed;
    }
  }

  const hbFile = path.join(DATA_DIR, "heartbeats.jsonl");
  let hbRes = { kept: 0, removed: 0 };
  await withLock(`file:${hbFile}`, async () => {
    hbRes = await pruneJsonlFile(hbFile, (obj) => {
      const ts = tryParseEventTimestamp(obj);
      if (!ts) return false;
      return ts.getTime() >= heartbeatCutoff;
    });
  });

  return {
    screenshotsDeleted,
    activityRemoved,
    eventsRemoved,
    heartbeatsRemoved: hbRes.removed,
  };
}
