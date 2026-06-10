import { detectHeartbeatGapsOnce } from "../jobs/heartbeatGapDetector";

const findManyMock = jest.fn();
const findFirstMock = jest.fn();
const updateMock = jest.fn();
const createMock = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    client: { findMany: (...args: unknown[]) => findManyMock(...args) },
    pcSession: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

describe("heartbeatGapDetector", () => {
  const NOW = new Date("2026-06-11T12:00:00Z");
  const LAST_HB = new Date("2026-06-11T11:45:00Z"); // 15 min ago — over the threshold

  beforeEach(() => {
    findManyMock.mockReset();
    findFirstMock.mockReset();
    updateMock.mockReset();
    createMock.mockReset();
  });

  it("closes an open explicit session and tags it explicit_with_gap_close", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "C1", lastHeartbeat: LAST_HB }]);
    findFirstMock.mockResolvedValueOnce({
      id: "sess-1",
      bootAt: new Date("2026-06-11T08:00:00Z"),
      source: "explicit",
    });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(1);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: {
        shutdownAt: LAST_HB,
        source: "explicit_with_gap_close",
      },
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates a synthetic heartbeat_gap session when no open session exists", async () => {
    findManyMock.mockResolvedValueOnce([{ id: "C2", lastHeartbeat: LAST_HB }]);
    findFirstMock.mockResolvedValueOnce(null);

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith({
      data: {
        clientId: "C2",
        bootAt: new Date(LAST_HB.getTime() - 60_000),
        shutdownAt: LAST_HB,
        source: "heartbeat_gap",
      },
    });
  });

  it("leaves an open session alone if its bootAt is newer than the last heartbeat", async () => {
    // Edge case: explicit Boot landed AFTER the last heartbeat (re-boot during gap).
    findManyMock.mockResolvedValueOnce([{ id: "C3", lastHeartbeat: LAST_HB }]);
    findFirstMock.mockResolvedValueOnce({
      id: "sess-3",
      bootAt: new Date("2026-06-11T11:50:00Z"),
      source: "explicit",
    });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
