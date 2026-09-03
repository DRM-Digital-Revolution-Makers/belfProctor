import crypto from "crypto";

export function makeId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(8).toString("hex");
  return `${prefix}_${stamp}_${rand}`;
}

