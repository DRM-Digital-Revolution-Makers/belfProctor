import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "./config";

/**
 * Single Prisma client for the process.
 *
 * Logging is environment-aware: in development we surface warnings and errors
 * (queries stay off to avoid noise), in production only errors. This keeps the
 * monkey-patched file logger in serverLog.ts from filling the disk with query
 * spam while still capturing real failures.
 */
const logLevels: Prisma.LogLevel[] = config.isProduction
  ? ["error"]
  : ["warn", "error"];

export const prisma = new PrismaClient({ log: logLevels });

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Establish the database connection before the server accepts traffic.
 *
 * Postgres frequently is not ready the instant the Node process starts (Docker
 * Compose, service boot ordering, a brief restart). Rather than crash-loop on
 * the first failed query, we retry with a fixed backoff. If the database is
 * still unreachable after the configured attempts we throw, letting the caller
 * decide whether to exit (production) or degrade (dev/test).
 */
export async function connectWithRetry(): Promise<void> {
  const { retries, retryDelayMs } = config.dbConnect;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await prisma.$connect();
      if (attempt > 1) {
        console.log(`[DB] Connected after ${attempt} attempt(s).`);
      }
      return;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt <= retries) {
        console.warn(
          `[DB] Connection attempt ${attempt}/${retries + 1} failed: ${message}. Retrying in ${retryDelayMs}ms...`,
        );
        await delay(retryDelayMs);
      }
    }
  }

  throw new Error(
    `Could not connect to the database after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Cleanly close the pool on shutdown so Postgres connections are not leaked. */
export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error("[DB] Error during disconnect:", err);
  }
}

/**
 * Lightweight liveness probe for the health endpoint. Returns latency in ms on
 * success; throws on failure so the caller can report the service as degraded.
 */
export async function pingDatabase(): Promise<number> {
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return Date.now() - start;
}
