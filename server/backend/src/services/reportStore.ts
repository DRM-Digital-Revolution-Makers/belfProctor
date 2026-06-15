import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { prisma } from "../prisma";

/**
 * Report persistence + presentation.
 *
 * Reports are JSON documents the agent generates (status / security / directory
 * listing) and uploads encrypted; the server decrypts them to
 * `storage/reports/{clientId}/{filename}`. This module owns turning those files
 * into DB-backed, listable, downloadable, CSV-exportable records.
 */

export function reportsRootDir(uploadDir: string): string {
  return path.join(uploadDir, "reports");
}

/** Extract the ISO timestamp embedded in a report filename, or null. */
function parseTimestampFromName(filename: string): Date | null {
  const m = filename.match(/(\d{4}-\d{2}-\d{2}T[\d-]+\.\d+Z)/);
  if (!m) return null;
  const datePart = m[1].substring(0, 10);
  const timePart = m[1].substring(11).replace(/-/g, ":");
  const d = new Date(`${datePart}T${timePart}`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Index report files already on disk that have no DB row — e.g. uploaded before
 * reports were tracked. Idempotent: known paths are skipped. Only files whose
 * client exists are indexed (the Report→Client foreign key requires it).
 *
 * @returns the number of new rows created
 */
export async function indexExistingReports(uploadDir: string): Promise<number> {
  const root = reportsRootDir(uploadDir);
  if (!fs.existsSync(root)) return 0;

  const [knownRows, clientRows] = await Promise.all([
    prisma.report.findMany({ select: { path: true } }),
    prisma.client.findMany({ select: { id: true } }),
  ]);
  const known = new Set(knownRows.map((r) => r.path));
  const clients = new Set(clientRows.map((c) => c.id));

  let created = 0;
  for (const clientId of await fsPromises.readdir(root)) {
    if (!clients.has(clientId)) continue;
    const clientDir = path.join(root, clientId);
    let dirStat: fs.Stats;
    try {
      dirStat = await fsPromises.stat(clientDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    for (const filename of await fsPromises.readdir(clientDir)) {
      const filePath = path.join(clientDir, filename);
      if (known.has(filePath)) continue;
      let fstat: fs.Stats;
      try {
        fstat = await fsPromises.stat(filePath);
      } catch {
        continue;
      }
      if (!fstat.isFile()) continue;

      const timestamp = parseTimestampFromName(filename) ?? fstat.mtime;
      try {
        await prisma.report.create({
          data: { clientId, filename, path: filePath, timestamp },
        });
        created++;
      } catch {
        // Unique/FK race with a concurrent upload — safe to ignore.
      }
    }
  }
  return created;
}

export interface ReportListItem {
  id: number;
  clientId: string;
  filename: string;
  timestamp: string;
}

export interface ReportListResult {
  data: ReportListItem[];
  total: number;
}

export interface ReportListFilters {
  clientId?: string;
  /** Inclusive lower bound. */
  from?: Date;
  /** Exclusive/inclusive upper bound. */
  to?: Date;
  page: number;
  pageSize: number;
}

/** Paginated, filtered report listing straight from the database (indexed). */
export async function listReports(
  filters: ReportListFilters,
): Promise<ReportListResult> {
  const where: {
    clientId?: string;
    timestamp?: { gte?: Date; lte?: Date };
  } = {};
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) where.timestamp.gte = filters.from;
    if (filters.to) where.timestamp.lte = filters.to;
  }

  const [rows, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: { id: true, clientId: true, filename: true, timestamp: true },
    }),
    prisma.report.count({ where }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      filename: r.filename,
      timestamp: r.timestamp.toISOString(),
    })),
    total,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) headerSet.add(k);
  }
  const headers = Array.from(headerSet);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function flattenToKeyValue(obj: unknown): Array<Record<string, unknown>> {
  const out: Array<{ key: string; value: unknown }> = [];
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    } else {
      out.push({ key: prefix, value });
    }
  };
  walk(obj, "");
  return out;
}

/**
 * Convert a report's JSON content to CSV. Chooses the most table-like shape:
 *  - a `Events` array (security report) → one row per event,
 *  - an `Entries` array (directory listing) → one row per file/directory,
 *  - otherwise a flattened key/value table of the document.
 * Non-JSON content degrades to a single-cell CSV rather than throwing.
 */
export function reportJsonToCsv(content: string): string {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return rowsToCsv([{ content }]);
  }

  const record = obj as Record<string, unknown>;

  if (Array.isArray(record?.Events) && record.Events.length > 0) {
    return rowsToCsv(record.Events as Array<Record<string, unknown>>);
  }

  if (Array.isArray(record?.Entries)) {
    const rows: Array<Record<string, unknown>> = [];
    for (const entry of record.Entries as Array<Record<string, unknown>>) {
      const root = entry?.root ?? "";
      for (const f of (entry?.files as Array<Record<string, unknown>>) ?? []) {
        rows.push({ root, kind: "file", ...f });
      }
      for (const d of (entry?.directories as Array<Record<string, unknown>>) ??
        []) {
        rows.push({ root, kind: "directory", ...d });
      }
    }
    if (rows.length > 0) return rowsToCsv(rows);
  }

  return rowsToCsv(flattenToKeyValue(obj));
}
