import path from "path";

function getEntryFile(): string {
  const mainFile =
    (require as any)?.main?.filename || process.argv[1] || __filename;
  return String(mainFile || "");
}

export function getAppDir(): string {
  const entry = getEntryFile();
  const entryDir = path.dirname(entry);
  return path.resolve(entryDir, "..");
}

export function resolveUploadDir(): string {
  const raw = String(process.env.UPLOAD_DIR || "").trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(getAppDir(), raw);
  }
  return path.join(getAppDir(), "storage");
}

