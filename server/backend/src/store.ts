import fs from "fs";
import path from "path";

const DATA_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendToFile(filename: string, data: any) {
  const filePath = path.join(DATA_DIR, filename);
  const line = JSON.stringify(data) + "\n";
  fs.appendFileSync(filePath, line, "utf8");
}

export function appendActivity(data: any) {
  appendToFile("activity.jsonl", { ...data, _ingestedAt: new Date() });
}

export function appendEvent(data: any) {
  appendToFile("events.jsonl", { ...data, _ingestedAt: new Date() });
}

export function clearEvents() {
  const filePath = path.join(DATA_DIR, "events.jsonl");
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "");
  }
}

export function appendHeartbeat(data: any) {
  // Overwrite or append? For heartbeats, we might want latest status.
  // For simplicity in file mode, we just append log.
  appendToFile("heartbeats.jsonl", { ...data, _ingestedAt: new Date() });
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

export function upsertAppStat(
  clientId: string,
  processName: string,
  timestamp: Date
) {
  let stats: Record<string, AppStat> = {};
  if (fs.existsSync(APPS_FILE)) {
    try {
      stats = JSON.parse(fs.readFileSync(APPS_FILE, "utf-8"));
    } catch (e) {
      stats = {};
    }
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

  fs.writeFileSync(APPS_FILE, JSON.stringify(stats, null, 2), "utf-8");
}
