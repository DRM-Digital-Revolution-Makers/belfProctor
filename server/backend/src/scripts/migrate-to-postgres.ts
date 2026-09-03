import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import readline from "readline";
import { PrismaClient, Prisma, Role, SystemEventType } from "@prisma/client";
import { resolveUploadDir } from "../runtimePaths";

const STORAGE_DIR = resolveUploadDir();
const MARKER_FILE = path.join(STORAGE_DIR, ".migrated_to_postgres");
const BATCH_SIZE = 500;

const prisma = new PrismaClient();

const FORCE = process.argv.includes("--force");

const SYSTEM_EVENT_TYPES = new Set<string>(Object.values(SystemEventType));

async function main() {
  console.log(`Source storage: ${STORAGE_DIR}`);

  if (!fs.existsSync(STORAGE_DIR)) {
    console.log("Storage directory does not exist — nothing to migrate.");
    return;
  }

  if (!FORCE && fs.existsSync(MARKER_FILE)) {
    console.log(
      `Marker ${MARKER_FILE} exists — already migrated. Re-run with --force to import again.`,
    );
    return;
  }

  await migrateUsers();
  await migrateClients();
  await migrateAppUsage();
  await migrateHeartbeats();
  await migrateEvents();
  await migrateActivity();
  await migrateCommands();
  await migrateTimesheet();
  await migrateFavorites();

  await fsPromises.writeFile(
    MARKER_FILE,
    `${new Date().toISOString()}\n`,
    "utf-8",
  );
  console.log(`\nDone. Marker written to ${MARKER_FILE}`);
}

async function migrateUsers(): Promise<void> {
  const fp = path.join(STORAGE_DIR, "users.json");
  if (!fs.existsSync(fp)) {
    console.log("users.json — not found, skipped.");
    return;
  }
  const raw = await fsPromises.readFile(fp, "utf-8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) {
    console.log("users.json — not an array, skipped.");
    return;
  }

  let imported = 0;
  for (const u of list) {
    if (!u?.email || !u?.passwordHash) continue;
    const role: Role = u.role === "VIEWER" ? Role.VIEWER : Role.ADMIN;
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        passwordHash: u.passwordHash,
        role,
        createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
      },
      update: {
        passwordHash: u.passwordHash,
        role,
      },
    });
    imported++;
  }
  console.log(`users.json → ${imported} User row(s)`);
}

async function migrateClients(): Promise<void> {
  const dir = path.join(STORAGE_DIR, "clients");
  if (!fs.existsSync(dir)) {
    console.log("clients/ — not found, skipped.");
    return;
  }
  const files = (await fsPromises.readdir(dir)).filter((f) =>
    f.endsWith(".json"),
  );

  let imported = 0;
  for (const f of files) {
    const raw = await fsPromises.readFile(path.join(dir, f), "utf-8");
    const c = JSON.parse(raw);
    if (!c?.id) continue;
    const sample = c.lastActivitySample ?? {};
    const data = {
      encryptionKey: c.encryptionKey || "",
      hostname: c.hostname ?? null,
      os: c.os ?? null,
      version: c.version ?? null,
      lastSeen: parseDate(c.lastSeen),
      lastHeartbeat: parseDate(c.lastHeartbeat),
      lastActivity: parseDate(c.lastActivity),
      lastActivityActiveMs: toInt(sample.activeMilliseconds),
      lastActivityInactiveMs: toInt(sample.inactiveMilliseconds),
    };
    await prisma.client.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        ...data,
        createdAt: parseDate(c.createdAt) ?? undefined,
      },
      update: data,
    });
    imported++;
  }
  console.log(`clients/*.json → ${imported} Client row(s)`);
}

async function migrateAppUsage(): Promise<void> {
  const fp = path.join(STORAGE_DIR, "apps.json");
  if (!fs.existsSync(fp)) {
    console.log("apps.json — not found, skipped.");
    return;
  }
  const raw = await fsPromises.readFile(fp, "utf-8");
  const map = JSON.parse(raw);
  if (!map || typeof map !== "object") {
    console.log("apps.json — not an object, skipped.");
    return;
  }

  let imported = 0;
  for (const entry of Object.values(map) as any[]) {
    if (!entry?.clientId || !entry?.processName) continue;
    const lastSeen = parseDate(entry.lastSeen) ?? new Date();
    const count = toInt(entry.count);
    await prisma.appUsage.upsert({
      where: {
        clientId_processName: {
          clientId: entry.clientId,
          processName: entry.processName,
        },
      },
      create: {
        clientId: entry.clientId,
        processName: entry.processName,
        count,
        lastSeen,
      },
      update: { count, lastSeen },
    });
    imported++;
  }
  console.log(`apps.json → ${imported} AppUsage row(s)`);
}

async function migrateHeartbeats(): Promise<void> {
  const fp = path.join(STORAGE_DIR, "heartbeats.jsonl");
  if (!fs.existsSync(fp)) {
    console.log("heartbeats.jsonl — not found, skipped.");
    return;
  }

  const existing = await prisma.heartbeat.count();
  if (existing > 0 && !FORCE) {
    console.log(`heartbeats.jsonl — Heartbeat table already has ${existing} rows, skipped.`);
    return;
  }

  let total = 0;
  const batch: Prisma.HeartbeatCreateManyInput[] = [];
  await streamJsonl(fp, (rec) => {
    const ts = parseDate(rec.timestamp);
    if (!rec.clientId || !ts) return;
    batch.push({
      clientId: String(rec.clientId),
      timestamp: ts,
      status: String(rec.status ?? "Online"),
      version: String(rec.version ?? ""),
    });
  });
  total = await flushInBatches(batch, (chunk) =>
    prisma.heartbeat.createMany({ data: chunk, skipDuplicates: true }),
  );
  console.log(`heartbeats.jsonl → ${total} Heartbeat row(s)`);
}

async function migrateEvents(): Promise<void> {
  const dir = path.join(STORAGE_DIR, "events");
  if (!fs.existsSync(dir)) {
    console.log("events/ — not found, skipped.");
    return;
  }

  const existing = await prisma.event.count();
  if (existing > 0 && !FORCE) {
    console.log(`events/ — Event table already has ${existing} rows, skipped.`);
    return;
  }

  const files = (await fsPromises.readdir(dir)).filter((f) =>
    f.endsWith(".jsonl"),
  );
  let total = 0;
  for (const f of files) {
    const batch: Prisma.EventCreateManyInput[] = [];
    await streamJsonl(path.join(dir, f), (rec) => {
      const ts = parseDate(rec.timestamp);
      const type = String(rec.eventType ?? "");
      if (!rec.clientId || !ts || !SYSTEM_EVENT_TYPES.has(type)) return;
      batch.push({
        clientId: String(rec.clientId),
        timestamp: ts,
        eventType: type as SystemEventType,
        description: rec.description ?? null,
        details: rec.details ?? null,
        processName: rec.processName ?? null,
        deviceId: rec.deviceId ?? null,
        networkAddress: rec.networkAddress ?? null,
        additionalData: rec.additionalData ?? null,
      });
    });
    total += await flushInBatches(batch, (chunk) =>
      prisma.event.createMany({ data: chunk, skipDuplicates: true }),
    );
  }
  console.log(`events/*.jsonl → ${total} Event row(s)`);
}

async function migrateActivity(): Promise<void> {
  const dir = path.join(STORAGE_DIR, "activity");
  if (!fs.existsSync(dir)) {
    console.log("activity/ — not found, skipped.");
    return;
  }

  const existing = await prisma.activity.count();
  if (existing > 0 && !FORCE) {
    console.log(`activity/ — Activity table already has ${existing} rows, skipped.`);
    return;
  }

  const files = (await fsPromises.readdir(dir)).filter((f) =>
    f.endsWith(".jsonl"),
  );
  let total = 0;
  for (const f of files) {
    const batch: Prisma.ActivityCreateManyInput[] = [];
    await streamJsonl(path.join(dir, f), (rec) => {
      const ts = parseDate(rec.timestamp);
      if (!rec.clientId || !ts) return;
      batch.push({
        clientId: String(rec.clientId),
        timestamp: ts,
        isActive: Boolean(rec.isActive),
        activeMilliseconds: toInt(rec.activeMilliseconds),
        inactiveMilliseconds: toInt(rec.inactiveMilliseconds),
      });
    });
    total += await flushInBatches(batch, (chunk) =>
      prisma.activity.createMany({ data: chunk, skipDuplicates: true }),
    );
  }
  console.log(`activity/*.jsonl → ${total} Activity row(s)`);
}

async function migrateCommands(): Promise<void> {
  const root = path.join(STORAGE_DIR, "commands");
  if (!fs.existsSync(root)) {
    console.log("commands/ — not found, skipped.");
    return;
  }

  const existing = await prisma.commandResult.count();
  if (existing > 0 && !FORCE) {
    console.log(`commands/ — CommandResult table already has ${existing} rows, skipped.`);
    return;
  }

  const clientDirs = await fsPromises.readdir(root);
  let total = 0;
  for (const clientId of clientDirs) {
    const dir = path.join(root, clientId);
    const stat = await fsPromises.stat(dir);
    if (!stat.isDirectory()) continue;

    const files = (await fsPromises.readdir(dir)).filter((f) =>
      f.endsWith(".json"),
    );
    const batch: Prisma.CommandResultCreateManyInput[] = [];
    for (const f of files) {
      const match = f.match(/^(.+)_(\d+)\.json$/);
      if (!match) continue;
      const commandId = match[1];
      const tsMs = Number(match[2]);
      const fp = path.join(dir, f);
      let payload: unknown;
      try {
        payload = JSON.parse(await fsPromises.readFile(fp, "utf-8"));
      } catch {
        continue;
      }
      batch.push({
        commandId,
        clientId,
        payload: payload as Prisma.InputJsonValue,
        receivedAt: Number.isFinite(tsMs) ? new Date(tsMs) : new Date(),
      });
    }
    total += await flushInBatches(batch, (chunk) =>
      prisma.commandResult.createMany({ data: chunk, skipDuplicates: true }),
    );
  }
  console.log(`commands/*/*.json → ${total} CommandResult row(s)`);
}

async function migrateTimesheet(): Promise<void> {
  const root = path.join(STORAGE_DIR, "timesheet");
  if (!fs.existsSync(root)) {
    console.log("timesheet/ — not found, skipped.");
    return;
  }
  const clientDirs = await fsPromises.readdir(root);
  let imported = 0;
  for (const clientId of clientDirs) {
    const dir = path.join(root, clientId);
    const stat = await fsPromises.stat(dir);
    if (!stat.isDirectory()) continue;

    const files = (await fsPromises.readdir(dir)).filter((f) =>
      f.endsWith(".json"),
    );
    for (const f of files) {
      const raw = await fsPromises.readFile(path.join(dir, f), "utf-8");
      const obj = JSON.parse(raw);
      const days = obj?.days;
      if (!days || typeof days !== "object") continue;

      for (const [dateKey, day] of Object.entries(days) as [string, any][]) {
        const date = parseDate(dateKey);
        if (!date) continue;
        const data = {
          startTime: parseDate(day.startTime),
          endTime: parseDate(day.endTime),
          activeMs: BigInt(toInt(day.activeMs)),
          presenceMs: BigInt(toInt(day.presenceMs)),
        };
        await prisma.timesheetDay.upsert({
          where: { clientId_date: { clientId, date } },
          create: { clientId, date, ...data },
          update: data,
        });
        imported++;
      }
    }
  }
  console.log(`timesheet/*/*.json → ${imported} TimesheetDay row(s)`);
}

async function migrateFavorites(): Promise<void> {
  const fp = path.join(STORAGE_DIR, "favorites.json");
  if (!fs.existsSync(fp)) {
    console.log("favorites.json — not found, skipped.");
    return;
  }
  const raw = await fsPromises.readFile(fp, "utf-8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) {
    console.log("favorites.json — not an array, skipped.");
    return;
  }
  let updated = 0;
  for (const filename of list) {
    if (typeof filename !== "string") continue;
    const result = await prisma.screenshot.updateMany({
      where: { filename },
      data: { isFavorite: true },
    });
    updated += result.count;
  }
  console.log(`favorites.json → ${updated} Screenshot row(s) flagged`);
}

async function streamJsonl(
  filePath: string,
  onRecord: (rec: any) => void,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      onRecord(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
}

async function flushInBatches<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const result = await insert(chunk);
    total += result.count;
  }
  return total;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
