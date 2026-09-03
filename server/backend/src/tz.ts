import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const TASHKENT_TZ = "Asia/Tashkent";

/**
 * Date string like "2026-06-11" representing the Tashkent calendar day of `d`.
 * Used as a stable key for grouping records into per-day buckets.
 */
export function tashkentDayKey(d: Date): string {
  return formatInTimeZone(d, TASHKENT_TZ, "yyyy-MM-dd");
}

/**
 * The UTC instant corresponding to 00:00:00.000 in Tashkent on the given day.
 */
export function startOfTashkentDay(d: Date): Date {
  const dayKey = tashkentDayKey(d);
  return fromZonedTime(`${dayKey}T00:00:00.000`, TASHKENT_TZ);
}

/**
 * The UTC instant corresponding to 23:59:59.999 in Tashkent on the given day.
 */
export function endOfTashkentDay(d: Date): Date {
  const dayKey = tashkentDayKey(d);
  return fromZonedTime(`${dayKey}T23:59:59.999`, TASHKENT_TZ);
}

/**
 * Bucket value for the Postgres `DATE` column (`TimesheetDay.date`).
 *
 * Prisma binds a JS Date to `@db.Date` by taking the UTC year/month/day. If we
 * passed `startOfTashkentDay(d)` here, that UTC instant lands at 19:00 of the
 * PREVIOUS UTC calendar day, so Postgres stored every row under day-1 (a
 * Monday Tashkent sample landed in the Sunday bucket and shifted the entire
 * column in the timesheet export by one day) [B-D1].
 *
 * Returning a UTC midnight whose UTC date already equals the Tashkent calendar
 * date makes Prisma's UTC-component serialization a no-op.
 */
export function dateBucketForTashkent(d: Date): Date {
  return new Date(`${tashkentDayKey(d)}T00:00:00.000Z`);
}

/**
 * Hour-of-day (0..23) in Tashkent time. Use this for hourly bucketing.
 */
export function tashkentHourOf(d: Date): number {
  return parseInt(formatInTimeZone(d, TASHKENT_TZ, "H"), 10);
}

/**
 * Minutes-since-midnight (0..1439) in Tashkent time. Use for HH:mm time-of-day filters.
 */
export function tashkentMinutesOfDay(d: Date): number {
  const [h, m] = formatInTimeZone(d, TASHKENT_TZ, "H:m").split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
