import { tashkentMonthBounds } from "../store";
import { startOfTashkentDay } from "../tz";

/**
 * TimesheetDay.date is stored as the UTC instant of Tashkent-midnight. A month
 * window therefore has to be expressed in Tashkent terms; the old UTC boundary
 * dropped the 1st of the month and pulled in the 1st of the next month [B-M11].
 */
describe("tashkentMonthBounds", () => {
  it("brackets June 2026 at Tashkent day edges (UTC+5)", () => {
    const { startOfMonth, endOfMonth } = tashkentMonthBounds(2026, 6);
    // Tashkent midnight June 1 == 2026-05-31T19:00:00Z
    expect(startOfMonth.toISOString()).toBe("2026-05-31T19:00:00.000Z");
    // Tashkent 23:59:59.999 June 30 == 2026-06-30T18:59:59.999Z
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
