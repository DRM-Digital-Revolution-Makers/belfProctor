import { prisma } from "../prisma";

const SYNTHETIC_BOOT_FALLBACK_MS = 60_000;

/**
 * Best-effort boot time when an explicit Boot event is missing (synthesized gap
 * session, or a Shutdown that arrived without a matching Boot).
 *
 * Uses the earliest heartbeat seen after the previous closed session and no
 * later than `before` (the heartbeat retention window bounds how far back this
 * can see). Falls back to one minute before `before` when there is no data, so
 * we never invent an implausibly long session nor a zero-duration one.
 */
export async function approximateBootAt(
  clientId: string,
  before: Date,
): Promise<Date> {
  const prevClosed = await prisma.pcSession.findFirst({
    where: { clientId, shutdownAt: { not: null } },
    orderBy: { shutdownAt: "desc" },
    select: { shutdownAt: true },
  });

  const earliest = await prisma.heartbeat.findFirst({
    where: {
      clientId,
      timestamp: prevClosed?.shutdownAt
        ? { gt: prevClosed.shutdownAt, lte: before }
        : { lte: before },
    },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true },
  });

  return (
    earliest?.timestamp ??
    new Date(before.getTime() - SYNTHETIC_BOOT_FALLBACK_MS)
  );
}
