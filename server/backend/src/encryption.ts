import crypto from "crypto";

const SALT = "BelfProctorSalt";
const ITERATIONS = 10000;
const KEYLEN = 32; // 256-bit
const DIGEST = "sha256";

export function deriveKeyFromPassword(password: string) {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(SALT, "utf-8"),
    ITERATIONS,
    KEYLEN,
    DIGEST
  );
}

export function decryptAes256CbcPrefixedIv(
  encrypted: Buffer,
  password: string
): Buffer {
  const key = deriveKeyFromPassword(password);
  // First 16 bytes are IV (AES block size 128-bit)
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

export function encryptAes256CbcPrefixedIv(
  plain: Buffer,
  password: string
): Buffer {
  const key = deriveKeyFromPassword(password);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

import fs from "fs";
import { pipeline } from "stream/promises";

export async function decryptFileStream(
  inputPath: string,
  outputPath: string,
  password: string
) {
  const key = deriveKeyFromPassword(password);
  const iv = Buffer.alloc(16);
  const fd = await fs.promises.open(inputPath, "r");
  try {
    const { bytesRead } = await fd.read(iv, 0, 16, 0);
    if (bytesRead < 16) throw new Error("File too short for IV");
  } finally {
    await fd.close();
  }

  const readStream = fs.createReadStream(inputPath, { start: 16 });
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const writeStream = fs.createWriteStream(outputPath);

  await pipeline(readStream, decipher, writeStream);
}
