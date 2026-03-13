export function getKeysToTry(clientKey?: string): string[] {
  const out: string[] = [];
  const ck = String(clientKey || "").trim();
  if (ck) out.push(ck);

  const multi = String(process.env.ENCRYPTION_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const k of multi) out.push(k);

  const primary = String(process.env.ENCRYPTION_KEY || "").trim();
  if (primary) out.push(primary);

  const fallback =
    "0000000000000000000000000000000000000000000000000000000000000000";
  out.push(fallback);

  return Array.from(new Set(out));
}

export function getPrimaryEncryptionKey(): string {
  const multi = String(process.env.ENCRYPTION_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length) return multi[0];
  const primary = String(process.env.ENCRYPTION_KEY || "").trim();
  if (primary) return primary;
  return "0000000000000000000000000000000000000000000000000000000000000000";
}
