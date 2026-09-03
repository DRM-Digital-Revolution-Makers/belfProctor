import { isSafeCommandId } from "../util/commandId";

describe("command id validation", () => {
  it("accepts generated and legacy-safe ids", () => {
    expect(isSafeCommandId("1750000000000_550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isSafeCommandId("cmd-7")).toBe(true);
  });

  it.each([
    "",
    "..",
    "../escape",
    "..\\escape",
    "id/child",
    "id\\child",
    "x".repeat(129),
  ])("rejects unsafe id %p", (value) => {
    expect(isSafeCommandId(value)).toBe(false);
  });
});
