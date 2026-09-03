import https from "https";

/**
 * Authoritative wall-clock time, sourced from a public HTTPS endpoint's
 * `Date:` response header (Cloudflare/Google clocks are NTP-synced).
 *
 * We do NOT trust the client's clock (it can be skewed by a misconfigured
 * Windows timezone), and we don't fully trust the server container clock
 * either. Instead we keep a millisecond-offset between Date.now() and the
 * external time, refreshing it periodically. All call sites use now() to
 * stamp incoming data, so timestamps are independent of every individual
 * machine running this code.
 */

const SYNC_SOURCES = [
  { hostname: "www.cloudflare.com", path: "/" },
  { hostname: "www.google.com", path: "/" },
];

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 5000;

let timeOffsetMs = 0;
let lastSyncAt: Date | null = null;
let lastSource: string | null = null;
let timer: NodeJS.Timeout | null = null;

function fetchHeadDate(hostname: string, path: string): Promise<Date | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Date | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = https.request(
      {
        method: "HEAD",
        hostname,
        path,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "User-Agent": "BelfProctor-TimeSync/1.0" },
      },
      (res) => {
        const dateHeader = res.headers.date;
        res.resume();
        if (!dateHeader) {
          finish(null);
          return;
        }
        const parsed = new Date(String(dateHeader));
        finish(Number.isFinite(parsed.getTime()) ? parsed : null);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
    req.end();
  });
}

async function syncOnce(): Promise<boolean> {
  for (const src of SYNC_SOURCES) {
    const localBefore = Date.now();
    const external = await fetchHeadDate(src.hostname, src.path);
    if (!external) continue;
    const localAfter = Date.now();
    // Account for half-RTT — the `Date:` header was generated at some moment
    // between localBefore and localAfter on this machine's clock. Take midpoint.
    const localMidpoint = (localBefore + localAfter) / 2;
    timeOffsetMs = external.getTime() - localMidpoint;
    lastSyncAt = new Date();
    lastSource = src.hostname;
    console.log(
      `[time-sync] source=${src.hostname} offset=${timeOffsetMs}ms (Δ=${(localAfter - localBefore)}ms RTT)`,
    );
    return true;
  }
  console.warn(
    "[time-sync] all sources failed — falling back to local clock",
  );
  return false;
}

/**
 * The authoritative current instant. Equal to `Date.now()` plus the synced
 * offset to the external HTTPS time source.
 */
export function now(): Date {
  return new Date(Date.now() + timeOffsetMs);
}

/**
 * Returns the timestamp the server would have stamped if it received the
 * given client-claimed timestamp. If the client timestamp is within
 * `acceptableDriftMs` of our authoritative time, we trust it (preserves
 * capture-time precision). Otherwise we replace it with `now()`.
 */
export function reconcile(clientTs: Date | null, acceptableDriftMs: number = 5 * 60_000): Date {
  const authoritative = now();
  if (!clientTs || Number.isNaN(clientTs.getTime())) return authoritative;
  const drift = Math.abs(clientTs.getTime() - authoritative.getTime());
  return drift <= acceptableDriftMs ? clientTs : authoritative;
}

export function startTimeSync(): void {
  if (timer) return;
  // Fire once immediately (don't await — startup mustn't block).
  syncOnce().catch(() => {});
  timer = setInterval(() => {
    syncOnce().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function getDebugState() {
  return {
    timeOffsetMs,
    lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
    lastSource,
    authoritativeNow: now().toISOString(),
    serverNow: new Date().toISOString(),
  };
}
