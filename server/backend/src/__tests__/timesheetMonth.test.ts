import { tashkentMonthBounds, tashkentMonthDateBucketBounds } from "../store";
import { dateBucketForTashkent, startOfTashkentDay } from "../tz";

/**
 * Two bounds shapes coexist:
 * - `tashkentMonthBounds` brackets a Tashkent calendar month as UTC instants —
 *   used for Activity.timestamp ranges.
 * - `tashkentMonthDateBucketBounds` returns the @db.Date values for the first
 *   and last days of the same Tashkent month — used for TimesheetDay.date.
 *
 * The two bounds shapes must NEVER be swapped (the off-by-one date bug came
 * from passing the timestamp-shaped value into a DATE-column comparison) [B-D1].
 */
describe("tashkentMonthBounds (Activity timestamp range)", () => {
  it("brackets June 2026 at Tashkent day edges (UTC+5)", () => {
    const { startOfMonth, endOfMonth } = tashkentMonthBounds(2026, 6);
    expect(startOfMonth.toISOString()).toBe("2026-05-31T19:00:00.000Z");
    expect(endOfMonth.toISOString()).toBe("2026-06-30T18:59:59.999Z");
  });

  it("includes the 1st of the month and excludes the 1st of the next month", () => {
    const { startOfMonth, endOfMonth } = tashkentMonthBounds(2026, 6);

    const june1 = startOfTashkentDay(new Date("2026-06-01T12:00:00Z"));
    const july1 = startOfTashkentDay(new Date("2026-07-01T12:00:00Z"));

    expect(june1 >= startOfMonth && june1 <= endOfMonth).toBe(true);
    expect(july1 > endOfMonth).toBe(true);
  });
});

describe("tashkentMonthDateBucketBounds (TimesheetDay.date range)", () => {
  it("returns inclusive bucket dates for the Tashkent month", () => {
    const { startDate, endDate } = tashkentMonthDateBucketBounds(2026, 6);
    expect(startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(endDate.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("matches dateBucketForTashkent for every day of the month", () => {
    const { startDate, endDate } = tashkentMonthDateBucketBounds(2026, 6);
    for (let day = 1; day <= 30; day += 1) {
      const tashkentNoon = new Date(`2026-06-${String(day).padStart(2, "0")}T12:00:00+05:00`);
      const bucket = dateBucketForTashkent(tashkentNoon);
      expect(bucket >= startDate && bucket <= endDate).toBe(true);
    }
  });
});

describe("dateBucketForTashkent", () => {
  it("maps a Tashkent timestamp to UTC midnight of the same calendar day", () => {
    // 23:30 on June 20 in Tashkent (= 18:30 UTC June 20) → bucket June 20.
    expect(
      dateBucketForTashkent(new Date("2026-06-20T18:30:00Z")).toISOString(),
    ).toBe("2026-06-20T00:00:00.000Z");

    // 00:30 on June 20 in Tashkent (= 19:30 UTC June 19) → bucket June 20.
    // The pre-fix code stored this as DATE 2026-06-19, shifting the column.
    expect(
      dateBucketForTashkent(new Date("2026-06-19T19:30:00Z")).toISOString(),
    ).toBe("2026-06-20T00:00:00.000Z");
  });
});
