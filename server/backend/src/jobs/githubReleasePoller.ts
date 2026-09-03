import { enqueueGitHubLatestSyncJob } from "../routes/updates";

let started = false;

function envFlag(name: string, fallback = false): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runScheduledSync(): void {
  try {
    const job = enqueueGitHubLatestSyncJob();
    console.log(`[updates:github:poller] queued latest release sync job ${job.id}`);
  } catch (e) {
    console.error(
      "[updates:github:poller] failed to queue latest release sync",
      (e as Error)?.message || e,
    );
  }
}

export function startGitHubReleasePoller(): void {
  if (started) return;
  if (!envFlag("GITHUB_RELEASE_POLL_ENABLED")) return;

  const repository = String(
    process.env.GITHUB_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY || "",
  ).trim();
  if (!repository) {
    console.warn(
      "[updates:github:poller] disabled: GITHUB_RELEASE_REPOSITORY is not configured",
    );
    return;
  }

  started = true;

  const intervalHours = envInt("GITHUB_RELEASE_POLL_INTERVAL_HOURS", 24);
  const startDelaySeconds = envInt("GITHUB_RELEASE_POLL_START_DELAY_SECONDS", 60);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(
    `[updates:github:poller] enabled: first check in ${startDelaySeconds}s, then every ${intervalHours}h`,
  );

  const startTimer = setTimeout(() => {
    runScheduledSync();
    const interval = setInterval(runScheduledSync, intervalMs);
    interval.unref?.();
  }, startDelaySeconds * 1000);
  startTimer.unref?.();
}
