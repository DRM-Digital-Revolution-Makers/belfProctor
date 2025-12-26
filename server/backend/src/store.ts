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

const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
if (!fs.existsSync(ACTIVITY_DIR))
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });

const EVENTS_DIR = path.join(DATA_DIR, "events");
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });

function appendToClientFile(dir: string, clientId: string, data: any) {
  if (!clientId) return;
  const filePath = path.join(dir, `${clientId}.jsonl`);
  const line = JSON.stringify(data) + "\n";
  fs.appendFileSync(filePath, line, "utf8");
}

export function appendActivity(data: any) {
  // Legacy monolithic file
  // appendToFile("activity.jsonl", { ...data, _ingestedAt: new Date() });

  // New per-client file
  appendToClientFile(ACTIVITY_DIR, data.clientId, {
    ...data,
    _ingestedAt: new Date(),
  });
}

export function appendEvent(data: any) {
  // Legacy monolithic file
  // appendToFile("events.jsonl", { ...data, _ingestedAt: new Date() });

  // New per-client file
  appendToClientFile(EVENTS_DIR, data.clientId, {
    ...data,
    _ingestedAt: new Date(),
  });
}

export function getClientActivity(clientId: string): any[] {
  const filePath = path.join(ACTIVITY_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function getClientEvents(clientId: string): any[] {
  const filePath = path.join(EVENTS_DIR, `${clientId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function clearEvents() {
  // Not supported easily with split files, or just rm -rf storage/events/*
  // Keeping empty implementation for now or removing usage
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
            "utf-8"
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
            fs.readFileSync(path.join(CLIENTS_DIR, f), "utf-8")
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
  } catch (e) {
    return undefined;
  }
}

export function saveClient(client: any) {
  if (!client.id) return;
  const filePath = path.join(CLIENTS_DIR, `${client.id}.json`);
  const existing = getClient(client.id) || {};
  const merged = {
    ...existing,
    ...client,
    updatedAt: new Date(),
    createdAt: existing.createdAt || new Date(),
  };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
}

export function deleteClient(id: string) {
  const filePath = path.join(CLIENTS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
