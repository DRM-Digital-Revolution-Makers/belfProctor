import {
  createAgentWsSignature,
  verifyAgentWsSignature,
  WS_AUTH_MAX_SKEW_SECONDS,
} from "../wsAuth";

describe("agent WebSocket authentication", () => {
  const now = 1_788_169_058;
  const clientId = "CLIENT05";
  const secret = "device-specific-secret";

  it("matches the cross-language C# protocol vector", () => {
    expect(createAgentWsSignature(clientId, String(now), secret)).toBe(
      "f79daa7bc9e2314ed5892c80c7fcdebb7766b5985d3b6d76f46340545c6476bf",
    );
  });

  it("accepts a valid signature inside the allowed clock window", () => {
    const timestamp = String(now - WS_AUTH_MAX_SKEW_SECONDS);
    expect(
      verifyAgentWsSignature({
        clientId,
        timestamp,
        signature: createAgentWsSignature(clientId, timestamp, secret),
        secrets: ["old-secret", secret],
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("rejects a signature for another client", () => {
    const timestamp = String(now);
    expect(
      verifyAgentWsSignature({
        clientId: "CLIENT06",
        timestamp,
        signature: createAgentWsSignature(clientId, timestamp, secret),
        secrets: [secret],
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects expired and future timestamps", () => {
    for (const timestamp of [
      String(now - WS_AUTH_MAX_SKEW_SECONDS - 1),
      String(now + WS_AUTH_MAX_SKEW_SECONDS + 1),
    ]) {
      expect(
        verifyAgentWsSignature({
          clientId,
          timestamp,
          signature: createAgentWsSignature(clientId, timestamp, secret),
          secrets: [secret],
          nowSeconds: now,
        }),
      ).toBe(false);
    }
  });

  it("rejects malformed input and an empty keyring", () => {
    expect(
      verifyAgentWsSignature({
        clientId,
        timestamp: "not-a-time",
        signature: "bad",
        secrets: [],
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
