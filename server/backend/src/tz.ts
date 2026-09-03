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
 * A Date whose UTC calendar date equals the Tashkent calendar date of `d`.
 *
 * Only use this for `@db.Date` (date-only, no time/tz) Prisma columns.
 * startOfTashkentDay() is wrong for those: it returns the UTC *instant* for
 * Tashkent midnight, which for UTC+5 always falls at 19:00 the *previous*
 * UTC calendar day (e.g. Tashkent 2026-07-13 00:00 == 2026-07-12T19:00:00Z).
 * A `@db.Date` column stores the UTC calendar date of whatever Date object
 * it's given, so writing startOfTashkentDay() there silently records the
 * *previous* day, every single time, for every row [B-TSD1].
 */
export function tashkentDateOnly(d: Date): Date {
  const dayKey = tashkentDayKey(d);
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/**
 * The UTC instant corresponding to 23:59:59.999 in Tashkent on the given day.
 */
export function endOfTashkentDay(d: Date): Date {
  const dayKey = tashkentDayKey(d);
  return fromZonedTime(`${dayKey}T23:59:59.999`, TASHKENT_TZ);
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
