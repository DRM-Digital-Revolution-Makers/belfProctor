import {
  createAgentUpdateDownloadSignature,
  createAgentWsSignature,
  verifyAgentUpdateDownloadSignature,
  verifyAgentWsSignature,
  WS_AUTH_MAX_SKEW_SECONDS,
} from "../wsAuth";

describe("agent WebSocket authentication", () => {
  const now = 1_788_169_058;
  const clientId = "CLIENT05";
  const secret = "device-specific-secret";
  const nonce = "00112233445566778899aabbccddeeff";

  it("matches the client update-download vector and binds the version", () => {
    const timestamp = "1788381000";
    const updateNonce = "0123456789abcdef0123456789abcdef";
    const signature = createAgentUpdateDownloadSignature(
      "CLIENT01",
      "2.1.0",
      timestamp,
      "device-key",
      updateNonce,
    );
    expect(signature).toBe(
      "f2c08725b1092ab0a0348aea6ec7fcc113666c910330efd94268750c58569434",
    );
    expect(verifyAgentUpdateDownloadSignature({
      clientId: "CLIENT01",
      version: "2.1.1",
      timestamp,
      nonce: updateNonce,
      signature,
      secrets: ["device-key"],
      nowSeconds: Number(timestamp),
    })).toBe(false);
  });

  it("matches the cross-language C# protocol vector", () => {
    expect(createAgentWsSignature(clientId, String(now), secret, nonce)).toBe(
      "dc6d73037835e0667e4a6bdb168740040a9925fb9e661dbae704c0e2ecd56bef",
    );
  });

  it("accepts a valid signature inside the allowed clock window", () => {
    const timestamp = String(now - WS_AUTH_MAX_SKEW_SECONDS);
    expect(
      verifyAgentWsSignature({
        clientId,
        timestamp,
        nonce,
        signature: createAgentWsSignature(clientId, timestamp, secret, nonce),
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
        nonce: "10112233445566778899aabbccddeeff",
        signature: createAgentWsSignature(clientId, timestamp, secret, nonce),
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
          nonce: "20112233445566778899aabbccddeeff",
          signature: createAgentWsSignature(clientId, timestamp, secret, "20112233445566778899aabbccddeeff"),
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
        nonce,
        signature: "bad",
        secrets: [],
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects replay of an already accepted nonce", () => {
    const timestamp = String(now);
    const replayNonce = "30112233445566778899aabbccddeeff";
    const input = {
      clientId,
      timestamp,
      nonce: replayNonce,
      signature: createAgentWsSignature(clientId, timestamp, secret, replayNonce),
      secrets: [secret],
      nowSeconds: now,
    };
    expect(verifyAgentWsSignature(input)).toBe(true);
    expect(verifyAgentWsSignature(input)).toBe(false);
  });
});
