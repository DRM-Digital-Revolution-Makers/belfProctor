import { prisma } from "../prisma";

const GAP_MINUTES = 10;
const TICK_INTERVAL_MS = 60_000;

/**
 * Closes a PcSession when a client stops sending heartbeats for >= GAP_MINUTES.
 * - If there's an open `explicit` boot, we close it as "explicit_with_gap_close" so
 *   the explicit bootAt is preserved.
 * - If there's no open session at all, we synthesize one entirely from the heartbeat
 *   pattern: this covers older clients that don't emit Boot/Shutdown.
 */
export async function detectHeartbeatGapsOnce(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - GAP_MINUTES * 60_000);
  const staleClients = await prisma.client.findMany({
    where: {
      lastHeartbeat: { lt: cutoff, not: null },
    },
    select: { id: true, lastHeartbeat: true },
  });

  let closed = 0;
  for (const c of staleClients) {
    if (!c.lastHeartbeat) continue;
    const openSession = await prisma.pcSession.findFirst({
      where: { clientId: c.id, shutdownAt: null },
      orderBy: { bootAt: "desc" },
    });

    if (openSession) {
      if (openSession.bootAt > c.lastHeartbeat) continue; // boot is newer — fresh start, leave it
      await prisma.pcSession.update({
        where: { id: openSession.id },
        data: {
          shutdownAt: c.lastHeartbeat,
          source:
            openSession.source === "explicit"
              ? "explicit_with_gap_close"
              : openSession.source,
        },
      });
      closed += 1;
      continue;
    }

    // No open session — synthesize. bootAt is approximate, shutdownAt is the last heartbeat.
    await prisma.pcSession.create({
      data: {
        clientId: c.id,
        bootAt: new Date(c.lastHeartbeat.getTime() - 60_000),
        shutdownAt: c.lastHeartbeat,
        source: "heartbeat_gap",
      },
    });
    closed += 1;
  }
  return closed;
}

let timer: NodeJS.Timeout | null = null;

export function startHeartbeatGapDetector(): void {
  if (timer) return;
  timer = setInterval(() => {
    detectHeartbeatGapsOnce().catch((e) => {
      console.error("[heartbeatGap] detector failed", e);
    });
  }, TICK_INTERVAL_MS);
  // Don't keep the event loop alive just for this — process exits cleanly on signal.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopHeartbeatGapDetector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
