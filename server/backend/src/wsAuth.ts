import crypto from "crypto";

export const WS_AUTH_MAX_SKEW_SECONDS = 120;
const usedNonces = new Map<string, number>();
const UPDATE_DOWNLOAD_DOMAIN = "belfproctor-update-download-v1";

export function createAgentWsSignature(
  clientId: string,
  timestamp: string,
  secret: string,
  nonce = "",
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${clientId}\n${timestamp}\n${nonce}`, "utf8")
    .digest("hex");
}

export function createAgentUpdateDownloadSignature(
  clientId: string,
  version: string,
  timestamp: string,
  secret: string,
  nonce: string,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(
      `${UPDATE_DOWNLOAD_DOMAIN}\n${clientId}\n${version}\n${timestamp}\n${nonce}`,
      "utf8",
    )
    .digest("hex");
}

function isFreshAuthenticatedNonce(input: {
  clientId: string;
  timestamp: string;
  signature: string;
  nonce: string;
  secrets: readonly string[];
  createExpected: (secret: string) => string;
  nowSeconds?: number;
}): boolean {
  const { clientId, timestamp, signature, nonce, secrets } = input;
  if (!clientId || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{32}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const parsedTimestamp = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsedTimestamp) > WS_AUTH_MAX_SKEW_SECONDS) return false;

  for (const [key, expiresAt] of usedNonces) {
    if (expiresAt < now) usedNonces.delete(key);
  }
  const replayKey = `${clientId}:${nonce.toLowerCase()}`;
  if (usedNonces.has(replayKey)) return false;

  const supplied = Buffer.from(signature, "hex");
  for (const secret of new Set(secrets.map((value) => String(value || "").trim()))) {
    if (!secret) continue;
    const expected = Buffer.from(input.createExpected(secret), "hex");
    if (crypto.timingSafeEqual(supplied, expected)) {
      usedNonces.set(replayKey, now + WS_AUTH_MAX_SKEW_SECONDS);
      return true;
    }
  }
  return false;
}

export function verifyAgentWsSignature(input: {
  clientId: string;
  timestamp: string;
  signature: string;
  nonce: string;
  secrets: readonly string[];
  nowSeconds?: number;
}): boolean {
  const { clientId, timestamp, nonce } = input;
  return isFreshAuthenticatedNonce({
    ...input,
    createExpected: (secret) =>
      createAgentWsSignature(clientId, timestamp, secret, nonce),
  });
}

export function verifyAgentUpdateDownloadSignature(input: {
  clientId: string;
  version: string;
  timestamp: string;
  signature: string;
  nonce: string;
  secrets: readonly string[];
  nowSeconds?: number;
}): boolean {
  const { clientId, version, timestamp, nonce } = input;
  if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) return false;
  return isFreshAuthenticatedNonce({
    ...input,
    createExpected: (secret) =>
      createAgentUpdateDownloadSignature(clientId, version, timestamp, secret, nonce),
  });
}
