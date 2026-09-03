import crypto from "crypto";

const SALT = "BelfProctorSalt";
const ITERATIONS = 10000;
const KEYLEN = 32; // 256-bit
const DIGEST = "sha256";
const GCM_MAGIC = Buffer.from("BPG1", "ascii");
const GCM_ITERATIONS = 210_000;
const GCM_HEADER_LEN = 4 + 16 + 12 + 16;

const MAX_KEY_CACHE = 200;
const derivedKeyCache = new Map<string, Buffer>();

export function deriveKeyFromPassword(password: string) {
  const p = String(password || "");
  const cached = derivedKeyCache.get(p);
  if (cached) {
    derivedKeyCache.delete(p);
    derivedKeyCache.set(p, cached);
    return cached;
  }
  return crypto.pbkdf2Sync(
    p,
    Buffer.from(SALT, "utf-8"),
    ITERATIONS,
    KEYLEN,
    DIGEST,
  );
}

function cacheDerivedKey(password: string, key: Buffer): Buffer {
  const p = String(password || "");
  if (!p) return key;
  derivedKeyCache.set(p, key);
  if (derivedKeyCache.size > MAX_KEY_CACHE) {
    const first = derivedKeyCache.keys().next().value;
    if (first) derivedKeyCache.delete(first);
  }
  return key;
}

export function decryptAes256CbcPrefixedIv(
  encrypted: Buffer,
  password: string,
): Buffer {
  if (encrypted.subarray(0, GCM_MAGIC.length).equals(GCM_MAGIC)) {
    if (encrypted.length < 4 + 16 + 12 + 16) throw new Error("AEAD envelope is truncated");
    const salt = encrypted.subarray(4, 20);
    const nonce = encrypted.subarray(20, 32);
    const tag = encrypted.subarray(32, 48);
    const ciphertext = encrypted.subarray(48);
    const key = crypto.pbkdf2Sync(password, salt, GCM_ITERATIONS, KEYLEN, DIGEST);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
  // Migration-only reader for envelopes emitted before v2. New writes are GCM.
  const key = cacheDerivedKey(password, deriveKeyFromPassword(password));
  // First 16 bytes are IV (AES block size 128-bit)
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

export function encryptAes256CbcPrefixedIv(
  plain: Buffer,
  password: string,
): Buffer {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, GCM_ITERATIONS, KEYLEN, DIGEST);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([GCM_MAGIC, salt, nonce, cipher.getAuthTag(), encrypted]);
}

import fs from "fs";
import util from "util";
import stream from "stream";

const pipeline = util.promisify(stream.pipeline);

export async function decryptFileStream(
  inputPath: string,
  outputPath: string,
  password: string,
) {
  const stagingPath = `${outputPath}.decrypt-${crypto.randomUUID()}.tmp`;
  const header = Buffer.alloc(GCM_HEADER_LEN);
  const fd = await fs.promises.open(inputPath, "r");
  let bytesRead = 0;
  try {
    ({ bytesRead } = await fd.read(header, 0, header.length, 0));
  } finally {
    await fd.close();
  }

  try {
    if (header.subarray(0, 4).equals(GCM_MAGIC)) {
      if (bytesRead < GCM_HEADER_LEN) throw new Error("Encrypted payload is too short");
      const salt = header.subarray(4, 20);
      const nonce = header.subarray(20, 32);
      const authTag = header.subarray(32, GCM_HEADER_LEN);
      const key = crypto.pbkdf2Sync(password, salt, GCM_ITERATIONS, KEYLEN, DIGEST);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(authTag);
      await pipeline(
        fs.createReadStream(inputPath, { start: GCM_HEADER_LEN }),
        decipher,
        fs.createWriteStream(stagingPath, { flags: "wx" }),
      );
    } else {
      // Migration-only streaming CBC reader.
      if (bytesRead < 16) throw new Error("File too short for IV");
      const key = cacheDerivedKey(password, deriveKeyFromPassword(password));
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, header.subarray(0, 16));
      await pipeline(
        fs.createReadStream(inputPath, { start: 16 }),
        decipher,
        fs.createWriteStream(stagingPath, { flags: "wx" }),
      );
    }

    // Publish only after authentication/final padding succeeds. A hard link is
    // atomic, stays on the same volume, and fails if outputPath already exists.
    await fs.promises.link(stagingPath, outputPath);
  } finally {
    await fs.promises.unlink(stagingPath).catch(() => undefined);
  }
}
