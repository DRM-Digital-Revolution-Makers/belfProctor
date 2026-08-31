import crypto from "crypto";

export const WS_AUTH_MAX_SKEW_SECONDS = 120;

export function createAgentWsSignature(
  clientId: string,
  timestamp: string,
  secret: string,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${clientId}\n${timestamp}`, "utf8")
    .digest("hex");
}

export function verifyAgentWsSignature(input: {
  clientId: string;
  timestamp: string;
  signature: string;
  secrets: readonly string[];
  nowSeconds?: number;
}): boolean {
  const { clientId, timestamp, signature, secrets } = input;
  if (!clientId || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const parsedTimestamp = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsedTimestamp) > WS_AUTH_MAX_SKEW_SECONDS) return false;

  const supplied = Buffer.from(signature, "hex");
  for (const secret of new Set(secrets.map((value) => String(value || "").trim()))) {
    if (!secret) continue;
    const expected = Buffer.from(
      createAgentWsSignature(clientId, timestamp, secret),
      "hex",
    );
    if (crypto.timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}
