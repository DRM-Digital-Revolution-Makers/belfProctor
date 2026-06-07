import { Prisma, PrismaClient, Role, SystemEventType } from "@prisma/client";
import { withLock } from "./locks";

const prisma = new PrismaClient();

const SYSTEM_EVENT_TYPES = new Set<string>(Object.values(SystemEventType));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type ActivityRow = {
  timestamp: Date;
  activeMilliseconds: number;
  inactiveMilliseconds: number;
};

function withClientWriteLock(
  clientId: string,
  fn: () => Promise<void>,
): Promise<void> {
  return withLock(`client:${clientId}`, fn);
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(String(value ?? Date.now()));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function activityDelta(
  curr: ActivityRow,
  prev: ActivityRow | null,
): { activeMs: number; inactiveMs: number } {
  if (!prev) return { activeMs: 0, inactiveMs: 0 };
  const dActive = curr.activeMilliseconds - prev.activeMilliseconds;
  const dInactive = curr.inactiveMilliseconds - prev.inactiveMilliseconds;
  return {
    activeMs: dActive >= 0 ? dActive : curr.activeMilliseconds,
    inactiveMs: dInactive >= 0 ? dInactive : curr.inactiveMilliseconds,
  };
}

// ---------- Activity ----------

export async function appendActivity(data: {
  clientId: string;
  timestamp: Date | string;
  isActive: boolean;
  activeMilliseconds: number;
  inactiveMilliseconds: number;
}): Promise<void> {
  if (!data.clientId) return;
  await prisma.activity.create({
    data: {
      clientId: data.clientId,
      timestamp: toDate(data.timestamp),
      isActive: Boolean(data.isActive),
      activeMilliseconds: Math.trunc(Number(data.activeMilliseconds) || 0),
      inactiveMilliseconds: Math.trunc(Number(data.inactiveMilliseconds) || 0),
    },
  });
}

export async function getClientActivity(
  clientId: string,
  limit: number = 30,
): Promise<any[]> {
  const rows = await prisma.activity.findMany({
    where: { clientId },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return rows.reverse();
}

export async function getLatestActivity(limit: number = 30): Promise<any[]> {
  return prisma.activity.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
  });
}

export async function getLatestActivityPerClient(
  maxClients: number = 100,
): Promise<any[]> {
  const clients = await prisma.client.findMany({
    where: { lastActivity: { not: null } },
    orderBy: { lastActivity: "desc" },
    take: maxClients,
    select: {
      id: true,
      lastActivity: true,
      lastActivityActiveMs: true,
      lastActivityInactiveMs: true,
    },
  });
  return clients.map((c) => ({
    clientId: c.id,
    timestamp: c.lastActivity,
    activeMilliseconds: c.lastActivityActiveMs,
    inactiveMilliseconds: c.lastActivityInactiveMs,
  }));
}

// ---------- Events ----------

export async function appendEvent(data: {
  clientId: string;
  timestamp: Date | string;
  eventType: string;
  description?: string | null;
  details?: string | null;
  processName?: string | null;
  deviceId?: string | null;
  networkAddress?: string | null;
  additionalData?: unknown;
}): Promise<void> {
  if (!data.clientId) return;
  if (!SYSTEM_EVENT_TYPES.has(data.eventType)) return;
  const create: Prisma.EventCreateInput = {
    client: { connect: { id: data.clientId } },
    timestamp: toDate(data.timestamp),
    eventType: data.eventType as SystemEventType,
    description: data.description ?? null,
    details: data.details ?? null,
    processName: data.processName ?? null,
    deviceId: data.deviceId ?? null,
    networkAddress: data.networkAddress ?? null,
  };
  if (data.additionalData != null) {
    create.additionalData = data.additionalData as Prisma.InputJsonValue;
  }
  await prisma.event.create({ data: create });
}

export async function getClientEvents(
  clientId: string,
  limit: number = 30,
): Promise<any[]> {
  const rows = await prisma.event.findMany({
    where: { clientId },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return rows.reverse();
}

export function clearEvents(): void {
  // kept for API compatibility; no-op
}

// ---------- Heartbeat ----------

export async function appendHeartbeat(data: {
  clientId: string;
  timestamp: Date | string;
  status?: string;
  version?: string;
}): Promise<void> {
  if (!data.clientId) return;
  const timestamp = toDate(data.timestamp);
  await prisma.$transaction([
    prisma.heartbeat.create({
      data: {
        clientId: data.clientId,
        timestamp,
        status: data.status ?? "Online",
        version: data.version ?? "",
      },
    }),
    prisma.client.update({
      where: { id: data.clientId },
      data: { lastHeartbeat: timestamp, lastSeen: timestamp },
    }),
  ]);
}

export async function getLatestHeartbeats(): Promise<any[]> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      lastHeartbeat: true,
      lastSeen: true,
      version: true,
    },
  });
  return clients.map((c) => ({
    clientId: c.id,
    timestamp: c.lastHeartbeat ?? c.lastSeen ?? null,
    lastHeartbeat: c.lastHeartbeat ?? c.lastSeen ?? null,
    lastSeen: c.lastHeartbeat ?? c.lastSeen ?? null,
    version: c.version ?? "",
    status: "Online",
  }));
}

// ---------- App usage ----------

export interface AppStat {
  clientId: string;
  processName: string;
  count: number;
  lastSeen: string;
}

export async function getAppStats(): Promise<AppStat[]> {
  const rows = await prisma.appUsage.findMany();
  return rows.map((r) => ({
    clientId: r.clientId,
    processName: r.processName,
    count: r.count,
    lastSeen: r.lastSeen.toISOString(),
  }));
}

export async function upsertAppStat(
  clientId: string,
  processName: string,
  timestamp: Date,
): Promise<void> {
  if (!clientId || !processName) return;
  await prisma.appUsage.upsert({
    where: { clientId_processName: { clientId, processName } },
    create: {
      clientId,
      processName,
      count: 1,
      lastSeen: timestamp,
    },
    update: {
      count: { increment: 1 },
      lastSeen: timestamp,
    },
  });
}

export async function streamAppCounts(
  clientId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ name: string; count: number }[]> {
  const grouped = await prisma.event.groupBy({
    by: ["processName"],
    where: {
      clientId,
      eventType: SystemEventType.AppUsage,
      timestamp: { gte: startDate, lte: endDate },
      processName: { not: null },
    },
    _count: { processName: true },
    orderBy: { _count: { processName: "desc" } },
    take: 5,
  });
  return grouped
    .filter((g) => g.processName)
    .map((g) => ({ name: g.processName as string, count: g._count.processName }));
}

// ---------- Clients ----------

export async function getClients(): Promise<any[]> {
  return prisma.client.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getClient(id: string): Promise<any | undefined> {
  if (!id) return undefined;
  const c = await prisma.client.findUnique({ where: { id } });
  return c ?? undefined;
}

export async function saveClient(data: {
  id: string;
  encryptionKey?: string;
  category?: string;
  hostname?: string;
  os?: string;
  version?: string;
  lastSeen?: Date | string;
  lastHeartbeat?: Date | string;
  lastActivity?: Date | string;
  createdAt?: Date | string;
}): Promise<void> {
  const id = String(data.id || "").trim();
  if (!id) return;

  const update: Prisma.ClientUpdateInput = {};
  if (data.encryptionKey !== undefined) update.encryptionKey = data.encryptionKey;
  if (data.category !== undefined) update.category = data.category;
  if (data.hostname !== undefined) update.hostname = data.hostname;
  if (data.os !== undefined) update.os = data.os;
  if (data.version !== undefined) update.version = data.version;
  if (data.lastSeen !== undefined) update.lastSeen = toDate(data.lastSeen);
  if (data.lastHeartbeat !== undefined)
    update.lastHeartbeat = toDate(data.lastHeartbeat);
  if (data.lastActivity !== undefined)
    update.lastActivity = toDate(data.lastActivity);

  await prisma.client.upsert({
    where: { id },
    create: {
      id,
      encryptionKey: data.encryptionKey ?? "",
      category: data.category ?? null,
      hostname: data.hostname ?? null,
      os: data.os ?? null,
      version: data.version ?? null,
      lastSeen: data.lastSeen ? toDate(data.lastSeen) : null,
      lastHeartbeat: data.lastHeartbeat ? toDate(data.lastHeartbeat) : null,
      lastActivity: data.lastActivity ? toDate(data.lastActivity) : null,
      createdAt: data.createdAt ? toDate(data.createdAt) : undefined,
    },
    update,
  });
}

export async function deleteClient(id: string): Promise<void> {
  if (!id) return;
  await prisma.client.delete({ where: { id } }).catch(() => undefined);
}

// ---------- Favorites (denormalized on Screenshot.isFavorite) ----------

export async function getFavorites(): Promise<string[]> {
  const rows = await prisma.screenshot.findMany({
    where: { isFavorite: true },
    select: { filename: true },
    distinct: ["filename"],
  });
  return rows.map((r) => r.filename);
}

export async function setFavorite(
  filename: string,
  isFavorite: boolean,
): Promise<void> {
  if (!filename) return;
  await prisma.screenshot.updateMany({
    where: { filename },
    data: { isFavorite },
  });
}

// ---------- Policies ----------

export async function getPolicies(): Promise<any[]> {
  return prisma.policy.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getPolicy(id: string): Promise<any | undefined> {
  if (!id) return undefined;
  const p = await prisma.policy.findUnique({ where: { id } });
  return p ?? undefined;
}

// ---------- Users ----------

export async function getUsers(): Promise<any[]> {
  return prisma.user.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getUser(email: string): Promise<any | undefined> {
  if (!email) return undefined;
  const u = await prisma.user.findUnique({ where: { email } });
  return u ?? undefined;
}

export async function saveUser(user: {
  email: string;
  passwordHash: string;
  role?: string;
}): Promise<void> {
  if (!user.email || !user.passwordHash) return;
  const role: Role = user.role === "VIEWER" ? Role.VIEWER : Role.ADMIN;
  await prisma.user.upsert({
    where: { email: user.email },
    create: {
      email: user.email,
      passwordHash: user.passwordHash,
      role,
    },
    update: {
      passwordHash: user.passwordHash,
      role,
    },
  });
}

// ---------- Activity aggregation ----------

async function loadActivityRowsInRange(
  clientId: string,
  start: Date,
  end: Date,
): Promise<ActivityRow[]> {
  return prisma.activity.findMany({
    where: {
      clientId,
      timestamp: { gte: start, lte: end },
    },
    orderBy: { timestamp: "asc" },
    select: {
      timestamp: true,
      activeMilliseconds: true,
      inactiveMilliseconds: true,
    },
  });
}

export async function streamDailyActivitySummary(
  clientId: string,
  startOfRange: Date,
  endOfRange: Date,
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
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    activeMs: 0,
    inactiveMs: 0,
    screenshotsCount: 0,
  }));

  const rows = await loadActivityRowsInRange(clientId, startOfRange, endOfRange);

  let prev: ActivityRow | null = null;
  let activeMs = 0;
  let inactiveMs = 0;
  for (const curr of rows) {
    const { activeMs: addA, inactiveMs: addI } = activityDelta(curr, prev);
    activeMs += addA;
    inactiveMs += addI;
    const hour = curr.timestamp.getUTCHours();
    if (hour >= 0 && hour < 24) {
      hourly[hour].activeMs += addA;
      hourly[hour].inactiveMs += addI;
    }
    prev = curr;
  }

  activeMs = Math.min(activeMs, ONE_DAY_MS);
  inactiveMs = Math.min(inactiveMs, ONE_DAY_MS - activeMs);
  return { activeMs, inactiveMs, hourly };
}

export async function streamMonthlyActivitySummary(
  clientId: string,
  startOfMonth: Date,
  endOfMonth: Date,
): Promise<{
  dailyActivity: Map<string, { activeMs: number; inactiveMs: number }>;
  totalActiveMs: number;
  totalInactiveMs: number;
}> {
  const rows = await loadActivityRowsInRange(clientId, startOfMonth, endOfMonth);
  const dailyActivity = new Map<
    string,
    { activeMs: number; inactiveMs: number }
  >();

  let prev: ActivityRow | null = null;
  for (const curr of rows) {
    const currDay = dayKey(curr.timestamp);
    if (prev && dayKey(prev.timestamp) === currDay) {
      const { activeMs: addA, inactiveMs: addI } = activityDelta(curr, prev);
      const st = dailyActivity.get(currDay) ?? { activeMs: 0, inactiveMs: 0 };
      st.activeMs += addA;
      st.inactiveMs += addI;
      dailyActivity.set(currDay, st);
    }
    prev = curr;
  }

  let totalActiveMs = 0;
  let totalInactiveMs = 0;
  for (const st of dailyActivity.values()) {
    st.activeMs = Math.min(st.activeMs, ONE_DAY_MS);
    st.inactiveMs = Math.min(st.inactiveMs, ONE_DAY_MS - st.activeMs);
    totalActiveMs += st.activeMs;
    totalInactiveMs += st.inactiveMs;
  }
  return { dailyActivity, totalActiveMs, totalInactiveMs };
}

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
  const rows = await loadActivityRowsInRange(clientId, startOfMonth, endOfMonth);
  const dailyMap = new Map<
    string,
    { firstTs: number; lastTs: number; activeMs: number; inactiveMs: number }
  >();

  let prev: ActivityRow | null = null;
  for (const curr of rows) {
    const t = curr.timestamp.getTime();
    const currDay = dayKey(curr.timestamp);
    let st = dailyMap.get(currDay);
    if (!st) {
      st = { firstTs: t, lastTs: t, activeMs: 0, inactiveMs: 0 };
      dailyMap.set(currDay, st);
    }
    st.lastTs = t;
    if (prev && dayKey(prev.timestamp) === currDay) {
      const { activeMs: addA, inactiveMs: addI } = activityDelta(curr, prev);
      st.activeMs += addA;
      st.inactiveMs += addI;
    }
    prev = curr;
  }

  const result = Array.from(dailyMap.entries()).map(([date, st]) => {
    const activeMs = Math.min(st.activeMs, ONE_DAY_MS);
    const inactiveMs = Math.min(st.inactiveMs, ONE_DAY_MS - activeMs);
    return {
      date,
      startTime: new Date(st.firstTs).toISOString(),
      endTime: new Date(st.lastTs).toISOString(),
      activeMs,
      presenceMs: activeMs + inactiveMs,
    };
  });
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

// ---------- Timesheet ingest ----------

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

  await withClientWriteLock(id, async () => {
    const existingClient = await prisma.client.findUnique({
      where: { id },
      select: {
        encryptionKey: true,
        lastActivity: true,
        lastActivityActiveMs: true,
        lastActivityInactiveMs: true,
      },
    });

    let addActive = 0;
    let addInactive = 0;
    if (
      existingClient?.lastActivity &&
      dayKey(existingClient.lastActivity) === dayKey(sampleTimestamp)
    ) {
      const dA = activeMilliseconds - existingClient.lastActivityActiveMs;
      const dI = inactiveMilliseconds - existingClient.lastActivityInactiveMs;
      addActive = dA >= 0 ? dA : activeMilliseconds;
      addInactive = dI >= 0 ? dI : inactiveMilliseconds;
    }

    const date = startOfDay(sampleTimestamp);

    const existingDay = await prisma.timesheetDay.findUnique({
      where: { clientId_date: { clientId: id, date } },
      select: { startTime: true, endTime: true, activeMs: true, presenceMs: true },
    });

    const startTime =
      existingDay?.startTime && existingDay.startTime <= sampleTimestamp
        ? existingDay.startTime
        : sampleTimestamp;
    const endTime =
      existingDay?.endTime && existingDay.endTime >= sampleTimestamp
        ? existingDay.endTime
        : sampleTimestamp;
    const activeMs =
      (existingDay?.activeMs ?? BigInt(0)) + BigInt(addActive);
    const presenceMs =
      (existingDay?.presenceMs ?? BigInt(0)) + BigInt(addActive + addInactive);

    const clientUpdate: Prisma.ClientUpdateInput = {
      lastSeen: now,
      lastActivity: sampleTimestamp,
      lastActivityActiveMs: Math.trunc(activeMilliseconds),
      lastActivityInactiveMs: Math.trunc(inactiveMilliseconds),
    };
    if (usedKey && existingClient?.encryptionKey !== usedKey) {
      clientUpdate.encryptionKey = usedKey;
    }
    if (clientMeta.hostname) clientUpdate.hostname = clientMeta.hostname;
    if (clientMeta.os) clientUpdate.os = clientMeta.os;
    if (clientMeta.version) clientUpdate.version = clientMeta.version;

    await prisma.$transaction([
      prisma.client.upsert({
        where: { id },
        create: {
          id,
          encryptionKey: usedKey || "",
          hostname: clientMeta.hostname ?? null,
          os: clientMeta.os ?? null,
          version: clientMeta.version ?? null,
          lastSeen: now,
          lastActivity: sampleTimestamp,
          lastActivityActiveMs: Math.trunc(activeMilliseconds),
          lastActivityInactiveMs: Math.trunc(inactiveMilliseconds),
        },
        update: clientUpdate,
      }),
      prisma.timesheetDay.upsert({
        where: { clientId_date: { clientId: id, date } },
        create: {
          clientId: id,
          date,
          startTime,
          endTime,
          activeMs,
          presenceMs,
        },
        update: {
          startTime,
          endTime,
          activeMs,
          presenceMs,
        },
      }),
    ]);
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

  const year = Number(match[1]);
  const month = Number(match[2]);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const rows = await streamTimesheetForClient(id, startOfMonth, endOfMonth);

  await withClientWriteLock(id, async () => {
    await prisma.timesheetDay.deleteMany({
      where: {
        clientId: id,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
    });
    if (rows.length === 0) return;
    await prisma.timesheetDay.createMany({
      data: rows.map((r) => ({
        clientId: id,
        date: startOfDay(new Date(r.date)),
        startTime: new Date(r.startTime),
        endTime: new Date(r.endTime),
        activeMs: BigInt(r.activeMs),
        presenceMs: BigInt(r.presenceMs),
      })),
    });
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
  const match = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const rows = await prisma.timesheetDay.findMany({
    where: { date: { gte: startOfMonth, lte: endOfMonth } },
    orderBy: [{ clientId: "asc" }, { date: "asc" }],
  });

  return rows.map((r) => ({
    clientId: r.clientId,
    date: dayKey(r.date),
    startTime: r.startTime ? r.startTime.toISOString() : null,
    endTime: r.endTime ? r.endTime.toISOString() : null,
    activeMs: Number(r.activeMs),
    presenceMs: Number(r.presenceMs),
  }));
}
