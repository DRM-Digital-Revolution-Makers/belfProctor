import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import readline from "readline";
import { withLock } from "./locks";
import { resolveUploadDir } from "./runtimePaths";

const DATA_DIR = resolveUploadDir();
const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
const EVENTS_DIR = path.join(DATA_DIR, "events");
const CLIENTS_DIR = path.join(DATA_DIR, "clients");
const TIMESHEET_DIR = path.join(DATA_DIR, "timesheet");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ACTIVITY_DIR))
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
if (!fs.existsSync(CLIENTS_DIR)) fs.mkdirSync(CLIENTS_DIR, { recursive: true });
if (!fs.existsSync(TIMESHEET_DIR))
  fs.mkdirSync(TIMESHEET_DIR, { recursive: true });

const OLD_CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
if (fs.existsSync(OLD_CLIENTS_FILE)) {
  try {
    const content = fs.readFileSync(OLD_CLIENTS_FILE, "utf-8");
    const oldClients = JSON.parse(content);
    if (Array.isArray(oldClients)) {
      for (const c of oldClients) {
        if (c && c.id) {
          fs.writeFileSync(
            path.join(CLIENTS_DIR, `${c.id}.json`),
            JSON.stringify(c, null, 2),
            "utf-8",
          );
        }
      }
    }
    fs.renameSync(OLD_CLIENTS_FILE, path.join(DATA_DIR, "clients.json.bak"));
  } catch {}
}

const TAIL_CHUNK = parseInt(process.env.STORE_TAIL_BYTES || "4096", 10);

function pad3(input: string | number | undefined): string {
  return String(input ?? "0")
    .padEnd(3, "0")
    .slice(0, 3);
}

function parseTimestampParts(value: unknown): {
  timeMs: number;
  dayKey: string;
  monthKey: string;
  hour: number;
  iso: string;
} | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/,
    );
    if (match) {
      const [, year, month, day, hour, minute, second, ms] = match;
      const timeMs = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(pad3(ms)),
      );
      return {
        timeMs,
        dayKey: `${year}-${month}-${day}`,
        monthKey: `${year}-${month}`,
        hour: Number(hour),
        iso: `${year}-${month}-${day}T${hour}:${minute}:${second}.${pad3(ms)}Z`,
      };
    }
  }

  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return {
    timeMs: parsed.getTime(),
    dayKey: iso.slice(0, 10),
    monthKey: iso.slice(0, 7),
    hour: Number(iso.slice(11, 13)),
    iso,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx]);
      }
    }),
  );
  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFileWithRetry(
  filePath: string,
  retries: number = 1,
): Promise<any | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      if (attempt >= retries) return null;
      await delay(25);
    }
  }
  return null;
}

async function writeJsonFileAtomic(
  filePath: string,
  json: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.tmp_${process.pid}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  await fsPromises.writeFile(tmp, json, "utf-8");
  try {
    await fsPromises.rename(tmp, filePath);
  } catch (e: any) {
    try {
      await fsPromises.unlink(filePath);
    } catch {}
    await fsPromises.rename(tmp, filePath);
  } finally {
    try {
      await fsPromises.unlink(tmp);
    } catch {}
  }
}

async function withClientWriteLock(
  clientId: string,
  fn: () => Promise<void>,
): Promise<void> {
  await withLock(`client:${clientId}`, fn);
}

async function withFileWriteLock(
  filePath: string,
  fn: () => Promise<void>,
): Promise<void> {
  await withLock(`file:${filePath}`, fn);
}

async function readLastLines(
  filePath: string,
  maxLines: number,
  maxBytesToRead: number = TAIL_CHUNK,
): Promise<string[]> {
  let fd: fsPromises.FileHandle | null = null;
  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.size === 0) return [];

    const bytesToRead = Math.min(stat.size, maxBytesToRead);
    const startOffset = stat.size - bytesToRead;

    fd = await fsPromises.open(filePath, "r");
    const buf = Buffer.alloc(bytesToRead);
    await fd.read(buf, 0, bytesToRead, startOffset);

    const text = buf.toString("utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    return lines.slice(-maxLines);
  } catch (e) {
    return [];
  } finally {
    if (fd) await fd.close();
  }
}

// Stream + compute daily activity aggregates. Never stores records—only prev+curr + small aggregates (CPU-heavy, ~0 heap).
export async function streamDailyActivitySummary(
  clientId: string,
  startOfDay: Date,
  endOfDay: Date,
): Promise<{
  activeMs: number;
  inactiveMs: number;
  hourly: {
    hour: number;
    activeMs: number;
    inactiveMs: number;
    screenshotsCount: number;
  }[];
}> {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    activeMs: 0,
    inactiveMs: 0,
    screenshotsCount: 0,
  }));

  if (!fs.existsSync(filePath)) {
    return { activeMs: 0, inactiveMs: 0, hourly };
  }

  const start = startOfDay.getTime();
  const end = endOfDay.getTime();
  let prev: any = null;
  let activeMs = 0;
  let inactiveMs = 0;

  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 1024,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const curr = JSON.parse(trimmed);
        const currTs = parseTimestampParts(curr.timestamp || curr.Timestamp);
        if (!currTs) return;
        const t = currTs.timeMs;
        if (t < start || t > end) return;
        if (prev !== null) {
          const dActive =
            (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0) -
            (prev.activeMilliseconds ?? prev.ActiveMilliseconds ?? 0);
          const dInactive =
            (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0) -
            (prev.inactiveMilliseconds ?? prev.InactiveMilliseconds ?? 0);
          const addActive =
            dActive >= 0
              ? dActive
              : (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0);
          const addInactive =
            dInactive >= 0
              ? dInactive
              : (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0);
          activeMs += addActive;
          inactiveMs += addInactive;
          const h = currTs.hour;
          if (h >= 0 && h < 24) {
            hourly[h].activeMs += addActive;
            hourly[h].inactiveMs += addInactive;
          }
        }
        prev = curr;
      } catch {
        /* skip */
      }
    });
    rl.on("close", () => {
      const ONE_DAY = 24 * 60 * 60 * 1000;
      activeMs = Math.min(activeMs, ONE_DAY);
      inactiveMs = Math.min(inactiveMs, ONE_DAY - activeMs);
      resolve({ activeMs, inactiveMs, hourly });
    });
    stream.on("error", reject);
  });
}

// Stream + compute monthly aggregates. Only Map<dateKey, {activeMs,inactiveMs}> + prev+curr.
export async function streamMonthlyActivitySummary(
  clientId: string,
  startOfMonth: Date,
  endOfMonth: Date,
): Promise<{
  dailyActivity: Map<string, { activeMs: number; inactiveMs: number }>;
  totalActiveMs: number;
  totalInactiveMs: number;
}> {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return {
      dailyActivity: new Map(),
      totalActiveMs: 0,
      totalInactiveMs: 0,
    };
  }
  const start = startOfMonth.getTime();
  const end = endOfMonth.getTime();
  let prev: any = null;
  const dailyActivity = new Map<
    string,
    { activeMs: number; inactiveMs: number }
  >();
  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 1024,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const curr = JSON.parse(trimmed);
        const currTs = parseTimestampParts(curr.timestamp || curr.Timestamp);
        if (!currTs) return;
        const t = currTs.timeMs;
        if (t < start || t > end) return;
        const currDay = currTs.dayKey;
        if (prev !== null) {
          const prevTs = parseTimestampParts(prev.timestamp || prev.Timestamp);
          const prevDay = prevTs?.dayKey || "";
          if (prevDay === currDay) {
            const dActive =
              (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0) -
              (prev.activeMilliseconds ?? prev.ActiveMilliseconds ?? 0);
            const dInactive =
              (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0) -
              (prev.inactiveMilliseconds ?? prev.InactiveMilliseconds ?? 0);
            const addActive =
              dActive >= 0
                ? dActive
                : (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0);
            const addInactive =
              dInactive >= 0
                ? dInactive
                : (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0);
            const st = dailyActivity.get(currDay) || {
              activeMs: 0,
              inactiveMs: 0,
            };
            st.activeMs += addActive;
            st.inactiveMs += addInactive;
            dailyActivity.set(currDay, st);
          }
        }
        prev = curr;
      } catch {
        /* skip */
      }
    });
    rl.on("close", () => {
      let totalActiveMs = 0;
      let totalInactiveMs = 0;
      const ONE_DAY = 24 * 60 * 60 * 1000;
      for (const st of dailyActivity.values()) {
        st.activeMs = Math.min(st.activeMs, ONE_DAY);
        st.inactiveMs = Math.min(st.inactiveMs, ONE_DAY - st.activeMs);
        totalActiveMs += st.activeMs;
        totalInactiveMs += st.inactiveMs;
      }
      resolve({ dailyActivity, totalActiveMs, totalInactiveMs });
    });
    stream.on("error", reject);
  });
}

/** Timesheet: per-day active/presence + first/last timestamp. */
export async function streamTimesheetForClient(
  clientId: string,
  startOfMonth: Date,
  endOfMonth: Date,
): Promise<
  {
    date: string;
    startTime: string;
    endTime: string;
    activeMs: number;
    presenceMs: number;
  }[]
> {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const start = startOfMonth.getTime();
  const end = endOfMonth.getTime();
  let prev: any = null;
  const dailyMap = new Map<
    string,
    {
      firstTs: number;
      lastTs: number;
      activeMs: number;
      inactiveMs: number;
    }
  >();
  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 1024,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const curr = JSON.parse(trimmed);
        const currTs = parseTimestampParts(curr.timestamp || curr.Timestamp);
        if (!currTs) return;
        const t = currTs.timeMs;
        if (t < start || t > end) return;
        const currDay = currTs.dayKey;
        let st = dailyMap.get(currDay);
        if (!st) {
          st = { firstTs: t, lastTs: t, activeMs: 0, inactiveMs: 0 };
          dailyMap.set(currDay, st);
        }
        st.lastTs = t;
        if (prev !== null) {
          const prevTs = parseTimestampParts(prev.timestamp || prev.Timestamp);
          const prevDay = prevTs?.dayKey || "";
          if (prevDay === currDay) {
            const dActive =
              (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0) -
              (prev.activeMilliseconds ?? prev.ActiveMilliseconds ?? 0);
            const dInactive =
              (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0) -
              (prev.inactiveMilliseconds ?? prev.InactiveMilliseconds ?? 0);
            st.activeMs +=
              dActive >= 0
                ? dActive
                : (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0);
            st.inactiveMs +=
              dInactive >= 0
                ? dInactive
                : (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0);
          }
        }
        prev = curr;
      } catch {
        /* skip */
      }
    });
    rl.on("close", () => {
      const ONE_DAY = 24 * 60 * 60 * 1000;
      const result: {
        date: string;
        startTime: string;
        endTime: string;
        activeMs: number;
        presenceMs: number;
      }[] = [];
      for (const [dateKey, st] of dailyMap.entries()) {
        const activeMs = Math.min(st.activeMs, ONE_DAY);
        const inactiveMs = Math.min(st.inactiveMs, ONE_DAY - activeMs);
        const presenceMs = activeMs + inactiveMs;
        result.push({
          date: dateKey,
          startTime: new Date(st.firstTs).toISOString(),
          endTime: new Date(st.lastTs).toISOString(),
          activeMs,
          presenceMs,
        });
      }
      result.sort((a, b) => a.date.localeCompare(b.date));
      resolve(result);
    });
    stream.on("error", reject);
  });
}

function getMonthKey(d: Date): string {
  return parseTimestampParts(d)?.monthKey || d.toISOString().slice(0, 7);
}

function getDayKey(d: Date): string {
  return parseTimestampParts(d)?.dayKey || d.toISOString().slice(0, 10);
}

type TimesheetDay = {
  date: string;
  startTime: string;
  endTime: string;
  activeMs: number;
  presenceMs: number;
};

type TimesheetFile = {
  clientId: string;
  month: string;
  days: Record<string, TimesheetDay>;
};

export async function ingestActivityToTimesheetAndClient(
  clientId: string,
  usedKey: string,
  now: Date,
  sampleTimestamp: Date,
  activeMilliseconds: number,
  inactiveMilliseconds: number,
  clientMeta: { hostname?: string; os?: string; version?: string } = {},
): Promise<void> {
  const id = String(clientId || "").trim();
  if (!id) return;
  const clientFilePath = path.join(CLIENTS_DIR, `${id}.json`);
  const monthKey = getMonthKey(sampleTimestamp);
  const dayKey = getDayKey(sampleTimestamp);
  const tsFilePath = path.join(TIMESHEET_DIR, id, `${monthKey}.json`);

  await withClientWriteLock(id, async () => {
    const existingClient =
      (await readJsonFileWithRetry(clientFilePath, 1)) || {};
    const prevSample = existingClient?.lastActivitySample || null;

    let addActive = 0;
    let addInactive = 0;
    try {
      if (prevSample) {
        const prevTs = new Date(
          prevSample.timestamp || prevSample.Timestamp || 0,
        );
        if (!isNaN(prevTs.getTime()) && getDayKey(prevTs) === dayKey) {
          const prevA = parseInt(
            String(
              prevSample.activeMilliseconds ??
                prevSample.ActiveMilliseconds ??
                0,
            ),
            10,
          );
          const prevI = parseInt(
            String(
              prevSample.inactiveMilliseconds ??
                prevSample.InactiveMilliseconds ??
                0,
            ),
            10,
          );
          const dA = activeMilliseconds - (Number.isFinite(prevA) ? prevA : 0);
          const dI =
            inactiveMilliseconds - (Number.isFinite(prevI) ? prevI : 0);
          addActive = dA >= 0 ? dA : activeMilliseconds;
          addInactive = dI >= 0 ? dI : inactiveMilliseconds;
        }
      }
    } catch {
      addActive = 0;
      addInactive = 0;
    }

    const existingTs = (await readJsonFileWithRetry(
      tsFilePath,
      1,
    )) as TimesheetFile | null;
    const ts: TimesheetFile =
      existingTs && existingTs.month === monthKey
        ? existingTs
        : { clientId: id, month: monthKey, days: {} };

    const iso = sampleTimestamp.toISOString();
    const existingDay = ts.days[dayKey];
    const day: TimesheetDay = existingDay
      ? { ...existingDay }
      : {
          date: dayKey,
          startTime: iso,
          endTime: iso,
          activeMs: 0,
          presenceMs: 0,
        };

    if (
      !day.startTime ||
      new Date(day.startTime).getTime() > sampleTimestamp.getTime()
    ) {
      day.startTime = iso;
    }
    if (
      !day.endTime ||
      new Date(day.endTime).getTime() < sampleTimestamp.getTime()
    ) {
      day.endTime = iso;
    }

    if (addActive > 0 || addInactive > 0) {
      day.activeMs =
        (Number.isFinite(day.activeMs) ? day.activeMs : 0) + addActive;
      day.presenceMs =
        (Number.isFinite(day.presenceMs) ? day.presenceMs : 0) +
        addActive +
        addInactive;
    }

    ts.days[dayKey] = day;
    await writeJsonFileAtomic(tsFilePath, JSON.stringify(ts, null, 2));

    const mergedClient: any = { ...existingClient, id };
    if (!mergedClient.createdAt) mergedClient.createdAt = now.toISOString();
    mergedClient.lastSeen = now.toISOString();
    mergedClient.lastActivity = iso;
    if (usedKey && mergedClient.encryptionKey !== usedKey)
      mergedClient.encryptionKey = usedKey;
    if (clientMeta.hostname) mergedClient.hostname = clientMeta.hostname;
    if (clientMeta.os) mergedClient.os = clientMeta.os;
    if (clientMeta.version) mergedClient.version = clientMeta.version;
    mergedClient.lastActivitySample = {
      timestamp: iso,
      activeMilliseconds,
      inactiveMilliseconds,
    };
    await writeJsonFileAtomic(
      clientFilePath,
      JSON.stringify(mergedClient, null, 2),
    );
  });
}

export async function backfillTimesheetFromActivity(
  clientId: string,
  monthStr: string,
): Promise<void> {
  const id = String(clientId || "").trim();
  if (!id) return;
  const match = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return;

  const [year, month] = monthStr.split("-").map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const rows = await streamTimesheetForClient(id, startOfMonth, endOfMonth);
  const days: Record<string, TimesheetDay> = {};
  for (const r of rows) {
    days[r.date] = {
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      activeMs: r.activeMs,
      presenceMs: r.presenceMs,
    };
  }

  const fp = path.join(TIMESHEET_DIR, id, `${monthStr}.json`);
  await withClientWriteLock(id, async () => {
    const payload: TimesheetFile = { clientId: id, month: monthStr, days };
    await writeJsonFileAtomic(fp, JSON.stringify(payload, null, 2));
  });
}

export async function getTimesheetDataForMonth(monthStr: string): Promise<
  {
    clientId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    activeMs: number;
    presenceMs: number;
  }[]
> {
  const clients = await getClients();
  const perClientRows = await mapWithConcurrency(
    clients,
    10,
    async (c: any) => {
      const id = String(c?.id || "").trim();
      if (!id) return [];
      const fp = path.join(TIMESHEET_DIR, id, `${monthStr}.json`);
      const parsed = (await readJsonFileWithRetry(
        fp,
        1,
      )) as TimesheetFile | null;
      const rowsByDate = new Map<
        string,
        {
          clientId: string;
          date: string;
          startTime: string | null;
          endTime: string | null;
          activeMs: number;
          presenceMs: number;
        }
      >();

      if (parsed && parsed.month === monthStr && parsed.days) {
        for (const day of Object.values(parsed.days)) {
          if (!day || !day.date) continue;
          rowsByDate.set(day.date, {
            clientId: id,
            date: day.date,
            startTime: day.startTime || null,
            endTime: day.endTime || null,
            activeMs: Number.isFinite(day.activeMs) ? day.activeMs : 0,
            presenceMs: Number.isFinite(day.presenceMs) ? day.presenceMs : 0,
          });
        }
      }

      const match = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
      if (match) {
        const [year, month] = monthStr.split("-").map(Number);
        const liveRows = await streamTimesheetForClient(
          id,
          new Date(year, month - 1, 1),
          new Date(year, month, 0, 23, 59, 59, 999),
        );

        for (const row of liveRows) {
          rowsByDate.set(row.date, {
            clientId: id,
            date: row.date,
            startTime: row.startTime || null,
            endTime: row.endTime || null,
            activeMs: Number.isFinite(row.activeMs) ? row.activeMs : 0,
            presenceMs: Number.isFinite(row.presenceMs) ? row.presenceMs : 0,
          });
        }
      }

      return Array.from(rowsByDate.values()).sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      );
    },
  );
  return perClientRows.flat();
}

// Stream events, count AppUsage only. Returns { name, count }[] top 5. No event array stored.
export async function streamAppCounts(
  clientId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ name: string; count: number }[]> {
  const filePath = path.join(EVENTS_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const start = startDate.getTime();
  const end = endDate.getTime();
  const counts = new Map<string, number>();
  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 1024,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  return new Promise((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const rec = JSON.parse(trimmed);
        if ((rec.eventType ?? rec.EventType) !== "AppUsage") return;
        const t = new Date(rec.timestamp || rec.Timestamp).getTime();
        if (t < start || t > end) return;
        const name = rec.processName ?? rec.ProcessName ?? "Unknown";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      } catch {
        /* skip */
      }
    });
    rl.on("close", () => {
      const top = Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      resolve(top);
    });
    stream.on("error", reject);
  });
}

async function appendToFile(filename: string, data: any): Promise<void> {
  await fsPromises.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, filename);
  const line = JSON.stringify(data) + "\n";
  await withFileWriteLock(filePath, async () => {
    await fsPromises.appendFile(filePath, line, "utf8");
  });
}

async function appendToClientFile(
  dir: string,
  clientId: string,
  data: any,
): Promise<void> {
  if (!clientId) return;
  await fsPromises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${clientId}.jsonl`);
  const line = JSON.stringify(data) + "\n";
  await withFileWriteLock(filePath, async () => {
    await fsPromises.appendFile(filePath, line, "utf8");
  });
}

export async function appendActivity(data: any): Promise<void> {
  await appendToClientFile(ACTIVITY_DIR, data.clientId, {
    ...data,
    _ingestedAt: new Date(),
  });
}

export async function appendEvent(data: any): Promise<void> {
  await appendToClientFile(EVENTS_DIR, data.clientId, {
    ...data,
    _ingestedAt: new Date(),
  });
}

/** Returns last `limit` activity records; max 4KB read. */
export async function getClientActivity(
  clientId: string,
  limit: number = 30,
  maxBytesToRead: number = TAIL_CHUNK,
): Promise<any[]> {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = await readLastLines(filePath, limit, maxBytesToRead);
  const out: any[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Returns last `limit` events; max 4KB read. */
export async function getClientEvents(
  clientId: string,
  limit: number = 30,
  maxBytesToRead: number = TAIL_CHUNK,
): Promise<any[]> {
  const filePath = path.join(EVENTS_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = await readLastLines(filePath, limit, maxBytesToRead);
  const out: any[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function clearEvents() {
  // Not supported easily with split files
}

export async function appendHeartbeat(data: any): Promise<void> {
  await appendToFile("heartbeats.jsonl", { ...data, _ingestedAt: new Date() });
}

// App Stats Storage
const APPS_FILE = path.join(DATA_DIR, "apps.json");

interface AppStat {
  clientId: string;
  processName: string;
  count: number;
  lastSeen: string; // ISO date
}

export async function getAppStats(): Promise<AppStat[]> {
  if (!fs.existsSync(APPS_FILE)) return [];
  try {
    const content = await fsPromises.readFile(APPS_FILE, "utf-8");
    const data = JSON.parse(content);
    return Object.values(data);
  } catch (e) {
    return [];
  }
}

export async function upsertAppStat(
  clientId: string,
  processName: string,
  timestamp: Date,
): Promise<void> {
  await withFileWriteLock(APPS_FILE, async () => {
    let stats: Record<string, AppStat> = {};
    try {
      const content = await fsPromises.readFile(APPS_FILE, "utf-8");
      stats = JSON.parse(content);
    } catch {
      stats = {};
    }

    const key = `${clientId}_${processName}`;
    if (!stats[key]) {
      stats[key] = {
        clientId,
        processName,
        count: 0,
        lastSeen: timestamp.toISOString(),
      };
    }

    stats[key].count++;
    if (new Date(timestamp) > new Date(stats[key].lastSeen)) {
      stats[key].lastSeen = timestamp.toISOString();
    }

    await fsPromises.writeFile(
      APPS_FILE,
      JSON.stringify(stats, null, 2),
      "utf-8",
    );
  });
}

export async function getClients(): Promise<any[]> {
  if (!fs.existsSync(CLIENTS_DIR)) return [];
  try {
    const files = await fsPromises.readdir(CLIENTS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const clients = await mapWithConcurrency(jsonFiles, 20, async (f) => {
      const fp = path.join(CLIENTS_DIR, f);
      return await readJsonFileWithRetry(fp, 1);
    });

    return clients.filter((c) => c !== null);
  } catch (e) {
    return [];
  }
}

export async function getClient(id: string): Promise<any | undefined> {
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  const parsed = await readJsonFileWithRetry(filePath, 1);
  return parsed ?? undefined;
}

export async function saveClient(data: any): Promise<void> {
  const id = String(data?.id || "").trim();
  if (!id) return;
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  await withClientWriteLock(id, async () => {
    const existing = (await readJsonFileWithRetry(filePath, 1)) || {};
    const merged = { ...existing, ...data, id };
    await writeJsonFileAtomic(filePath, JSON.stringify(merged, null, 2));
  });
}

export async function deleteClient(id: string): Promise<void> {
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) await fsPromises.unlink(filePath);
}

// Global Activity — 4KB per file, 5 lines each
export async function getLatestActivity(limit: number = 30): Promise<any[]> {
  if (!fs.existsSync(ACTIVITY_DIR)) return [];
  const files = await fsPromises.readdir(ACTIVITY_DIR);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
  const all: any[] = [];
  const perFile = 5;
  const bytesPerFile = TAIL_CHUNK;

  const perFileRecords = await mapWithConcurrency(jsonlFiles, 20, async (f) => {
    const lines = await readLastLines(
      path.join(ACTIVITY_DIR, f),
      perFile,
      bytesPerFile,
    );
    const out: any[] = [];
    for (const l of lines) {
      try {
        out.push(JSON.parse(l));
      } catch {}
    }
    return out;
  });
  for (const arr of perFileRecords) all.push(...arr);

  all.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return all.slice(0, limit);
}

/** One latest activity record per client (for /activity/latest, needed for 20+ clients) */
export async function getLatestActivityPerClient(
  maxClients: number = 100,
): Promise<any[]> {
  if (!fs.existsSync(ACTIVITY_DIR)) return [];
  const files = await fsPromises.readdir(ACTIVITY_DIR);
  const jsonlFiles = files
    .filter((f) => f.endsWith(".jsonl"))
    .slice(0, maxClients);

  const results = await mapWithConcurrency(jsonlFiles, 50, async (f) => {
    const filePath = path.join(ACTIVITY_DIR, f);
    const lines = await readLastLines(filePath, 1, TAIL_CHUNK);
    if (lines.length === 0) return null;
    try {
      const rec = JSON.parse(lines[lines.length - 1]);
      const clientId = path.basename(f, ".jsonl");
      return {
        ...rec,
        clientId: rec.clientId || clientId,
      };
    } catch {
      return null;
    }
  });

  return results.filter((r) => r !== null);
}

// Heartbeats — 32KB tail for 20+ clients (~200 lines), env HEARTBEAT_TAIL_BYTES overrides
const HEARTBEAT_TAIL_BYTES = parseInt(
  process.env.HEARTBEAT_TAIL_BYTES || "32768",
  10,
);

export async function getLatestHeartbeats(): Promise<any[]> {
  const filePath = path.join(DATA_DIR, "heartbeats.jsonl");
  const fromJsonl: any[] = [];

  if (fs.existsSync(filePath)) {
    const lines = await readLastLines(filePath, 200, HEARTBEAT_TAIL_BYTES);
    const latestMap = new Map<string, any>();
    for (const line of lines) {
      try {
        const hb = JSON.parse(line);
        if (hb.clientId) latestMap.set(hb.clientId, hb);
      } catch {
        /* skip */
      }
    }
    fromJsonl.push(...latestMap.values());
  }

  const clients = await getClients();
  const byClient = new Map<string, any>();
  for (const hb of fromJsonl) {
    byClient.set(hb.clientId, { ...hb });
  }

  for (const c of clients) {
    if (!c.id) continue;
    const lastHb = c.lastHeartbeat || c.lastSeen;
    const existing = byClient.get(c.id) || {};
    const out = { ...existing, clientId: c.id };
    if (lastHb) {
      out.lastHeartbeat = lastHb;
      out.lastSeen = lastHb;
      out.timestamp = out.timestamp || lastHb;
    } else if (existing.timestamp && !out.lastHeartbeat) {
      out.lastHeartbeat = existing.timestamp;
      out.lastSeen = existing.timestamp;
    }
    byClient.set(c.id, out);
  }
  return Array.from(byClient.values());
}

// Favorites Storage
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");

export async function getFavorites(): Promise<string[]> {
  if (!fs.existsSync(FAVORITES_FILE)) return [];
  try {
    const content = await fsPromises.readFile(FAVORITES_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function setFavorite(
  filename: string,
  isFavorite: boolean,
): Promise<void> {
  await withFileWriteLock(FAVORITES_FILE, async () => {
    let list: string[] = [];
    try {
      const content = await fsPromises.readFile(FAVORITES_FILE, "utf-8");
      const parsed = JSON.parse(content);
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }
    const favs = new Set(list);
    if (isFavorite) favs.add(filename);
    else favs.delete(filename);
    await writeJsonFileAtomic(
      FAVORITES_FILE,
      JSON.stringify(Array.from(favs), null, 2),
    );
  });
}

// Policies Storage for NO_DB
const POLICIES_FILE = path.join(DATA_DIR, "policies.json");

export async function getPolicies(): Promise<any[]> {
  if (!fs.existsSync(POLICIES_FILE)) return [];
  try {
    const content = await fsPromises.readFile(POLICIES_FILE, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

export async function getPolicy(id: string): Promise<any | undefined> {
  const policies = await getPolicies();
  return policies.find((p: any) => p.id === id);
}

// Users Storage (File-based)
const USERS_FILE = path.join(DATA_DIR, "users.json");

export async function getUsers(): Promise<any[]> {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const content = await fsPromises.readFile(USERS_FILE, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

export async function getUser(email: string): Promise<any | undefined> {
  const users = await getUsers();
  return users.find((u: any) => u.email === email);
}

export async function saveUser(user: any): Promise<void> {
  await withFileWriteLock(USERS_FILE, async () => {
    let users: any[] = [];
    try {
      const content = await fsPromises.readFile(USERS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      users = Array.isArray(parsed) ? parsed : [];
    } catch {
      users = [];
    }
    const index = users.findIndex((u: any) => u.email === user.email);
    if (index >= 0) {
      users[index] = { ...users[index], ...user, updatedAt: new Date() };
    } else {
      users.push({
        ...user,
        id: user.id || `${Date.now()}_${Math.random()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await writeJsonFileAtomic(USERS_FILE, JSON.stringify(users, null, 2));
  });
}
