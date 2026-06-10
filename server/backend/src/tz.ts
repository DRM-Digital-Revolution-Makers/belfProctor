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
 * Hour-of-day (0..23) in Tashkent time. Use this for hourly bucketing.
 */
export function tashkentHourOf(d: Date): number {
  return parseInt(formatInTimeZone(d, TASHKENT_TZ, "H"), 10);
}
