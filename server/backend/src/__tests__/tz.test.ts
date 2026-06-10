import {
  endOfTashkentDay,
  startOfTashkentDay,
  tashkentDayKey,
  tashkentHourOf,
} from "../tz";

describe("Asia/Tashkent helpers (UTC+5, no DST)", () => {
  it("tashkentDayKey: a UTC instant before 19:00 stays on the same calendar day", () => {
    // 2026-06-11T18:30:00Z = 2026-06-11T23:30 Tashkent — still June 11
    expect(tashkentDayKey(new Date("2026-06-11T18:30:00Z"))).toBe("2026-06-11");
  });

  it("tashkentDayKey: a UTC instant at 19:00 rolls into the next Tashkent day", () => {
    // 2026-06-11T19:00:00Z = 2026-06-12T00:00 Tashkent — June 12
    expect(tashkentDayKey(new Date("2026-06-11T19:00:00Z"))).toBe("2026-06-12");
  });

  it("startOfTashkentDay: returns the UTC instant of 00:00 Tashkent for the input's day", () => {
    // 2026-06-11T10:00 Tashkent → 00:00 Tashkent = 2026-06-10T19:00Z
    const start = startOfTashkentDay(new Date("2026-06-11T05:00:00Z"));
    expect(start.toISOString()).toBe("2026-06-10T19:00:00.000Z");
  });

  it("endOfTashkentDay: returns the UTC instant of 23:59:59.999 Tashkent for the input's day", () => {
    const end = endOfTashkentDay(new Date("2026-06-11T05:00:00Z"));
    expect(end.toISOString()).toBe("2026-06-11T18:59:59.999Z");
  });

  it("tashkentHourOf: produces the wall-clock hour in Tashkent", () => {
    // 09:30 UTC = 14:30 Tashkent
    expect(tashkentHourOf(new Date("2026-06-11T09:30:00Z"))).toBe(14);
    // 23:30 UTC = 04:30 next day Tashkent
    expect(tashkentHourOf(new Date("2026-06-11T23:30:00Z"))).toBe(4);
  });
});
