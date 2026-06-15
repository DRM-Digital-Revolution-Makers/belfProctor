import { detectHeartbeatGapsOnce } from "../jobs/heartbeatGapDetector";

const clientFindMany = jest.fn();
const pcFindFirst = jest.fn();
const pcUpdate = jest.fn();
const pcCreate = jest.fn();
const hbFindFirst = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    client: { findMany: (...a: unknown[]) => clientFindMany(...a) },
    pcSession: {
      findFirst: (...a: unknown[]) => pcFindFirst(...a),
      update: (...a: unknown[]) => pcUpdate(...a),
      create: (...a: unknown[]) => pcCreate(...a),
    },
    heartbeat: { findFirst: (...a: unknown[]) => hbFindFirst(...a) },
  },
}));

/** Route a pcSession.findFirst call by its `where.shutdownAt` shape. */
function routePcFindFirst(handlers: {
  open?: unknown; // shutdownAt: null
  recorded?: unknown; // shutdownAt: <Date>
  prevClosed?: unknown; // shutdownAt: { not: null }
}) {
  pcFindFirst.mockImplementation((args: any) => {
    const sd = args?.where?.shutdownAt;
    if (sd === null) return Promise.resolve(handlers.open ?? null);
    if (sd && typeof sd === "object" && "not" in sd) {
      return Promise.resolve(handlers.prevClosed ?? null);
    }
    return Promise.resolve(handlers.recorded ?? null);
  });
}

describe("heartbeatGapDetector", () => {
  const NOW = new Date("2026-06-11T12:00:00Z");
  const LAST_HB = new Date("2026-06-11T11:45:00Z"); // 15 min ago — over the threshold

  beforeEach(() => {
    clientFindMany.mockReset();
    pcFindFirst.mockReset();
    pcUpdate.mockReset();
    pcCreate.mockReset();
    hbFindFirst.mockReset();
    hbFindFirst.mockResolvedValue(null);
    pcCreate.mockResolvedValue({});
    pcUpdate.mockResolvedValue({});
  });

  it("closes an open explicit session and tags it explicit_with_gap_close", async () => {
    clientFindMany.mockResolvedValueOnce([{ id: "C1", lastHeartbeat: LAST_HB }]);
    routePcFindFirst({
      open: {
        id: "sess-1",
        bootAt: new Date("2026-06-11T08:00:00Z"),
        source: "explicit",
      },
    });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(1);
    expect(pcUpdate).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { shutdownAt: LAST_HB, source: "explicit_with_gap_close" },
    });
    expect(pcCreate).not.toHaveBeenCalled();
  });

  it("creates a synthetic heartbeat_gap session when no open session exists", async () => {
    clientFindMany.mockResolvedValueOnce([{ id: "C2", lastHeartbeat: LAST_HB }]);
    routePcFindFirst({ open: null, recorded: null, prevClosed: null });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(1);
    expect(pcUpdate).not.toHaveBeenCalled();
    expect(pcCreate).toHaveBeenCalledWith({
      data: {
        clientId: "C2",
        bootAt: new Date(LAST_HB.getTime() - 60_000), // fallback (no heartbeat data)
        shutdownAt: LAST_HB,
        source: "heartbeat_gap",
      },
    });
  });

  it("uses the earliest heartbeat as bootAt when available", async () => {
    const EARLIEST = new Date("2026-06-11T09:30:00Z");
    clientFindMany.mockResolvedValueOnce([{ id: "C4", lastHeartbeat: LAST_HB }]);
    routePcFindFirst({ open: null, recorded: null, prevClosed: null });
    hbFindFirst.mockResolvedValueOnce({ timestamp: EARLIEST });

    await detectHeartbeatGapsOnce(NOW);

    expect(pcCreate).toHaveBeenCalledWith({
      data: {
        clientId: "C4",
        bootAt: EARLIEST,
        shutdownAt: LAST_HB,
        source: "heartbeat_gap",
      },
    });
  });

  it("does NOT create a duplicate synthetic session for an already-recorded gap", async () => {
    clientFindMany.mockResolvedValueOnce([{ id: "C5", lastHeartbeat: LAST_HB }]);
    routePcFindFirst({
      open: null,
      recorded: { id: "existing-gap" }, // a session already closed at LAST_HB
      prevClosed: null,
    });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(0);
    expect(pcCreate).not.toHaveBeenCalled();
  });

  it("leaves an open session alone if its bootAt is newer than the last heartbeat", async () => {
    clientFindMany.mockResolvedValueOnce([{ id: "C3", lastHeartbeat: LAST_HB }]);
    routePcFindFirst({
      open: {
        id: "sess-3",
        bootAt: new Date("2026-06-11T11:50:00Z"),
        source: "explicit",
      },
    });

    const closed = await detectHeartbeatGapsOnce(NOW);

    expect(closed).toBe(0);
    expect(pcUpdate).not.toHaveBeenCalled();
    expect(pcCreate).not.toHaveBeenCalled();
  });
});
