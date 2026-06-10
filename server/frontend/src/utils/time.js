import dayjs from "dayjs";

export const TASHKENT_TZ = "Asia/Tashkent";

/**
 * Format an instant (Date | string | number) as Asia/Tashkent wall-clock time.
 * Pass any dayjs format string (default: "DD.MM.YYYY HH:mm:ss").
 * Returns "—" for null/undefined/invalid input so callers don't have to guard.
 */
export function formatTashkent(value, fmt = "DD.MM.YYYY HH:mm:ss") {
  if (value === null || value === undefined || value === "") return "—";
  const d = dayjs(value);
  if (!d.isValid()) return "—";
  return d.tz(TASHKENT_TZ).format(fmt);
}

/**
 * "YYYY-MM-DD" of the Tashkent calendar day containing `value`.
 */
export function tashkentDateKey(value) {
  return dayjs(value).tz(TASHKENT_TZ).format("YYYY-MM-DD");
}

/**
 * Hour-of-day (0..23) in Tashkent wall-clock time.
 */
export function tashkentHour(value) {
  return dayjs(value).tz(TASHKENT_TZ).hour();
}
