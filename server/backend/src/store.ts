import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import readline from "readline";

const DATA_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

// Ultra low memory: 4KB default. Env STORE_TAIL_BYTES. Target ~30MB for 20 clients.
const TAIL_CHUNK = parseInt(process.env.STORE_TAIL_BYTES || "4096", 10);

function readLastLinesSync(
  filePath: string,
  maxLines: number,
  maxBytesToRead: number = TAIL_CHUNK,
): string[] {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return [];
    const bytesToRead = Math.min(stat.size, maxBytesToRead);
    const startOffset = stat.size - bytesToRead;
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, startOffset);
      const text = buf.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      return lines.slice(-maxLines);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

// Stream + compute daily activity aggregates. Never stores records—only prev+curr + small aggregates (CPU-heavy, ~0 heap).
export function streamDailyActivitySummary(
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
  if (!fs.existsSync(filePath)) {
    const hourly = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      activeMs: 0,
      inactiveMs: 0,
      screenshotsCount: 0,
    }));
    return Promise.resolve({ activeMs: 0, inactiveMs: 0, hourly });
  }
  const start = startOfDay.getTime();
  const end = endOfDay.getTime();
  let prev: any = null;
  let activeMs = 0;
  let inactiveMs = 0;
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    activeMs: 0,
    inactiveMs: 0,
    screenshotsCount: 0,
  }));
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
        const t = new Date(curr.timestamp || curr.Timestamp).getTime();
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
          const h = new Date(curr.timestamp || curr.Timestamp).getHours();
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
export function streamMonthlyActivitySummary(
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
    return Promise.resolve({
      dailyActivity: new Map(),
      totalActiveMs: 0,
      totalInactiveMs: 0,
    });
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
        const t = new Date(curr.timestamp || curr.Timestamp).getTime();
        if (t < start || t > end) return;
        const currDay = new Date(curr.timestamp || curr.Timestamp)
          .toISOString()
          .split("T")[0];
        if (prev !== null) {
          const prevDay = new Date(prev.timestamp || prev.Timestamp)
            .toISOString()
            .split("T")[0];
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
export function streamTimesheetForClient(
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
  if (!fs.existsSync(filePath)) return Promise.resolve([]);
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
        const t = new Date(curr.timestamp || curr.Timestamp).getTime();
        if (t < start || t > end) return;
        const currDay = new Date(curr.timestamp || curr.Timestamp)
          .toISOString()
          .split("T")[0];
        let st = dailyMap.get(currDay);
        if (!st) {
          st = { firstTs: t, lastTs: t, activeMs: 0, inactiveMs: 0 };
          dailyMap.set(currDay, st);
        }
        st.lastTs = t;
        if (prev !== null) {
          const prevDay = new Date(prev.timestamp || prev.Timestamp)
            .toISOString()
            .split("T")[0];
          if (prevDay === currDay) {
            const dActive =
              (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0) -
              (prev.activeMilliseconds ?? prev.ActiveMilliseconds ?? 0);
            const dInactive =
              (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0) -
              (prev.inactiveMilliseconds ?? prev.InactiveMilliseconds ?? 0);
            st.activeMs += dActive >= 0 ? dActive : (curr.activeMilliseconds ?? curr.ActiveMilliseconds ?? 0);
            st.inactiveMs += dInactive >= 0 ? dInactive : (curr.inactiveMilliseconds ?? curr.InactiveMilliseconds ?? 0);
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
  const [year, month] = monthStr.split("-").map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
  const clients = getClients();
  const results = await Promise.all(
    clients.map(async (c) => {
      const rows = await streamTimesheetForClient(
        c.id,
        startOfMonth,
        endOfMonth,
      );
      return rows.map((r) => ({
        clientId: c.id,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        activeMs: r.activeMs,
        presenceMs: r.presenceMs,
      }));
    }),
  );
  return results.flat();
}

// Stream events, count AppUsage only. Returns { name, count }[] top 5. No event array stored.
export function streamAppCounts(
  clientId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ name: string; count: number }[]> {
  const filePath = path.join(EVENTS_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return Promise.resolve([]);
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

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function appendToFile(filename: string, data: any): Promise<void> {
  const filePath = path.join(DATA_DIR, filename);
  const line = JSON.stringify(data) + "\n";
  await fsPromises.appendFile(filePath, line, "utf8");
}

const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
if (!fs.existsSync(ACTIVITY_DIR))
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });

const EVENTS_DIR = path.join(DATA_DIR, "events");
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });

async function appendToClientFile(
  dir: string,
  clientId: string,
  data: any,
): Promise<void> {
  if (!clientId) return;
  const filePath = path.join(dir, `${clientId}.jsonl`);
  const line = JSON.stringify(data) + "\n";
  await fsPromises.appendFile(filePath, line, "utf8");
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
export function getClientActivity(
  clientId: string,
  limit: number = 30,
  maxBytesToRead: number = TAIL_CHUNK,
): any[] {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = readLastLinesSync(filePath, limit, maxBytesToRead);
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
export function getClientEvents(
  clientId: string,
  limit: number = 30,
  maxBytesToRead: number = TAIL_CHUNK,
): any[] {
  const filePath = path.join(EVENTS_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = readLastLinesSync(filePath, limit, maxBytesToRead);
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
  // Not supported easily with split files, or just rm -rf storage/events/*
  // Keeping empty implementation for now or removing usage
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

export function getAppStats(): AppStat[] {
  if (!fs.existsSync(APPS_FILE)) return [];
  try {
    const content = fs.readFileSync(APPS_FILE, "utf-8");
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
}

// Client Storage (File-based, scalable)
const CLIENTS_DIR = path.join(DATA_DIR, "clients");

// Ensure clients directory exists
if (!fs.existsSync(CLIENTS_DIR)) {
  fs.mkdirSync(CLIENTS_DIR, { recursive: true });
}

// Migrate existing clients.json if it exists
const OLD_CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
if (fs.existsSync(OLD_CLIENTS_FILE)) {
  try {
    const content = fs.readFileSync(OLD_CLIENTS_FILE, "utf-8");
    const oldClients = JSON.parse(content);
    if (Array.isArray(oldClients)) {
      oldClients.forEach((c) => {
        if (c.id) {
          fs.writeFileSync(
            path.join(CLIENTS_DIR, `${c.id}.json`),
            JSON.stringify(c, null, 2),
            "utf-8",
          );
        }
      });
    }
    // Rename old file to avoid confusion/double migration
    fs.renameSync(OLD_CLIENTS_FILE, path.join(DATA_DIR, "clients.json.bak"));
  } catch (e) {
    console.error("Failed to migrate old clients.json", e);
  }
}

export function getClients(): any[] {
  if (!fs.existsSync(CLIENTS_DIR)) return [];
  try {
    const files = fs
      .readdirSync(CLIENTS_DIR)
      .filter((f) => f.endsWith(".json"));
    return files
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(CLIENTS_DIR, f), "utf-8"),
          );
        } catch {
          return null;
        }
      })
      .filter((c) => c !== null);
  } catch (e) {
    return [];
  }
}

export function getClient(id: string): any | undefined {
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

export async function saveClient(data: any): Promise<void> {
  const filePath = path.join(CLIENTS_DIR, `${data.id}.json`);
  let existing: any = {};
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    existing = JSON.parse(content);
  } catch {
    /* file may not exist */
  }
  const merged = { ...existing, ...data };
  await fsPromises.writeFile(
    filePath,
    JSON.stringify(merged, null, 2),
    "utf-8",
  );
}

export function deleteClient(id: string) {
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Global Activity — 4KB per file, 5 lines each
export function getLatestActivity(limit: number = 30): any[] {
  if (!fs.existsSync(ACTIVITY_DIR)) return [];
  const files = fs
    .readdirSync(ACTIVITY_DIR)
    .filter((f) => f.endsWith(".jsonl"));
  const all: any[] = [];
  const perFile = 5;
  const bytesPerFile = TAIL_CHUNK;
  for (const f of files) {
    const lines = readLastLinesSync(
      path.join(ACTIVITY_DIR, f),
      perFile,
      bytesPerFile,
    );
    for (const l of lines) {
      try {
        all.push(JSON.parse(l));
      } catch {
        /* skip */
      }
    }
  }
  all.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return all.slice(0, limit);
}

/** One latest activity record per client (for /activity/latest, needed for 20+ clients) */
export function getLatestActivityPerClient(maxClients: number = 100): any[] {
  if (!fs.existsSync(ACTIVITY_DIR)) return [];
  const files = fs
    .readdirSync(ACTIVITY_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .slice(0, maxClients);
  const results: any[] = [];
  for (const f of files) {
    const filePath = path.join(ACTIVITY_DIR, f);
    const lines = readLastLinesSync(filePath, 1, TAIL_CHUNK);
    if (lines.length === 0) continue;
    try {
      const rec = JSON.parse(lines[lines.length - 1]);
      const clientId = path.basename(f, ".jsonl");
      results.push({
        ...rec,
        clientId: rec.clientId || clientId,
      });
    } catch {
      /* skip */
    }
  }
  return results;
}

// Heartbeats — 32KB tail for 20+ clients (~200 lines), env HEARTBEAT_TAIL_BYTES overrides
const HEARTBEAT_TAIL_BYTES = parseInt(
  process.env.HEARTBEAT_TAIL_BYTES || "32768",
  10,
);
export function getLatestHeartbeats(): any[] {
  const filePath = path.join(DATA_DIR, "heartbeats.jsonl");
  const fromJsonl: any[] = [];
  if (fs.existsSync(filePath)) {
    const lines = readLastLinesSync(filePath, 200, HEARTBEAT_TAIL_BYTES);
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
  // Merge with client lastHeartbeat — source of truth (updated on every heartbeat).
  // heartbeats.jsonl tail can scroll out; clients/X.json never does.
  const clients = getClients();
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

export function getFavorites(): string[] {
  if (!fs.existsSync(FAVORITES_FILE)) return [];
  try {
    const content = fs.readFileSync(FAVORITES_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export function setFavorite(filename: string, isFavorite: boolean) {
  let favs = new Set(getFavorites());
  if (isFavorite) {
    favs.add(filename);
  } else {
    favs.delete(filename);
  }
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(Array.from(favs)), "utf-8");
}

// Policies Storage for NO_DB
const POLICIES_FILE = path.join(DATA_DIR, "policies.json");

export function getPolicies(): any[] {
  if (!fs.existsSync(POLICIES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(POLICIES_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

export function getPolicy(id: string): any | undefined {
  return getPolicies().find((p: any) => p.id === id);
}

// Users Storage (File-based)
const USERS_FILE = path.join(DATA_DIR, "users.json");

export function getUsers(): any[] {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

export function getUser(email: string): any | undefined {
  return getUsers().find((u: any) => u.email === email);
}

export function saveUser(user: any) {
  const users = getUsers();
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
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}
