import { config, INSECURE_DEFAULT_ENCRYPTION_KEY } from "./config";

/**
 * Build the ordered list of keys to attempt when decrypting a client payload.
 *
 * Priority:
 *   1. the key the client registered with (most specific),
 *   2. every key configured via ENCRYPTION_KEY / ENCRYPTION_KEYS,
 *   3. the all-zeros default — only when {@link AppConfig.allowDefaultEncryptionKey}
 *      permits it (kept for backward compatibility with clients still on the
 *      shipped default, but never offered in a hardened production deployment).
 */
export function getKeysToTry(clientKey?: string): string[] {
  const out: string[] = [];

  const ck = String(clientKey || "").trim();
  if (ck) out.push(ck);

  for (const k of config.encryptionKeys) out.push(k);

  if (config.allowDefaultEncryptionKey) {
    out.push(INSECURE_DEFAULT_ENCRYPTION_KEY);
  }

  return Array.from(new Set(out));
}

/**
 * The key used to ENCRYPT outbound payloads to a client (e.g. policy bundles).
 * Returns the configured primary key, falling back to the shipped default so a
 * never-configured pilot install still functions.
 */
export function getPrimaryEncryptionKey(): string {
  return config.encryptionKeys[0] ?? INSECURE_DEFAULT_ENCRYPTION_KEY;
}
