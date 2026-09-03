import {
  decryptFileStream,
  decryptAes256CbcPrefixedIv,
  deriveKeyFromPassword,
  encryptAes256CbcPrefixedIv,
} from "../encryption";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

describe("versioned AEAD envelope", () => {
  const secret = "unique-device-secret-with-at-least-32-bytes";

  it("round-trips and emits the BPG1 envelope", () => {
    const plain = Buffer.from("authenticated payload", "utf8");
    const encrypted = encryptAes256CbcPrefixedIv(plain, secret);
    expect(encrypted.subarray(0, 4).toString("ascii")).toBe("BPG1");
    expect(decryptAes256CbcPrefixedIv(encrypted, secret)).toEqual(plain);
  });

  it("rejects ciphertext tampering", () => {
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.from("payload"), secret);
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptAes256CbcPrefixedIv(encrypted, secret)).toThrow();
  });

  it("uses a fresh salt and nonce for every envelope", () => {
    const plain = Buffer.from("same payload");
    expect(encryptAes256CbcPrefixedIv(plain, secret)).not.toEqual(
      encryptAes256CbcPrefixedIv(plain, secret),
    );
  });

  it("rejects a truncated versioned envelope", () => {
    expect(() => decryptAes256CbcPrefixedIv(Buffer.from("BPG1"), secret)).toThrow(
      "truncated",
    );
  });

  it("reads the legacy CBC format for queued-data migration only", () => {
    const plain = Buffer.from("legacy queued payload");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", deriveKeyFromPassword(secret), iv);
    const legacy = Buffer.concat([iv, cipher.update(plain), cipher.final()]);
    expect(decryptAes256CbcPrefixedIv(legacy, secret)).toEqual(plain);
    // Exercise and verify the bounded derivation cache path too.
    expect(deriveKeyFromPassword(secret)).toEqual(deriveKeyFromPassword(secret));
  });

  it("decrypts current and legacy encrypted files without overwriting output", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belf-crypto-"));
    const currentInput = path.join(dir, "current.enc");
    const currentOutput = path.join(dir, "current.bin");
    const legacyInput = path.join(dir, "legacy.enc");
    const legacyOutput = path.join(dir, "legacy.bin");
    const plain = Buffer.from("file payload");
    try {
      await fs.writeFile(currentInput, encryptAes256CbcPrefixedIv(plain, secret));
      await decryptFileStream(currentInput, currentOutput, secret);
      expect(await fs.readFile(currentOutput)).toEqual(plain);
      await expect(decryptFileStream(currentInput, currentOutput, secret)).rejects.toThrow();

      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", deriveKeyFromPassword(secret), iv);
      await fs.writeFile(legacyInput, Buffer.concat([iv, cipher.update(plain), cipher.final()]));
      await decryptFileStream(legacyInput, legacyOutput, secret);
      expect(await fs.readFile(legacyOutput)).toEqual(plain);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("publishes no partial file when streaming AEAD authentication fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belf-crypto-tamper-"));
    const input = path.join(dir, "tampered.enc");
    const output = path.join(dir, "must-not-exist.bin");
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.alloc(2 * 1024 * 1024, 0x5a), secret);
    encrypted[encrypted.length - 1] ^= 1;
    try {
      await fs.writeFile(input, encrypted);
      await expect(decryptFileStream(input, output, secret)).rejects.toThrow();
      await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await fs.readdir(dir)).some((name) => name.includes(".decrypt-"))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
