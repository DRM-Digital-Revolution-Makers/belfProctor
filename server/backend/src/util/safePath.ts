import path from "path";

/**
 * Path-traversal guards for any endpoint that maps user-supplied input onto the
 * filesystem.
 *
 * WHY: `path.join(baseDir, userInput)` does NOT contain the result — a value
 * like `../../etc/passwd` (or its URL-encoded form) escapes `baseDir`, and
 * `res.sendFile` will happily serve whatever absolute path it resolves to.
 */

/**
 * Resolve `segments` beneath `baseDir` and guarantee the result stays inside it.
 *
 * @returns the absolute path, or `null` if the inputs would escape `baseDir`
 *   (path traversal, an absolute segment, or — on Windows — a different drive).
 */
export function resolveWithinDir(
  baseDir: string,
  ...segments: string[]
): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);

  const rel = path.relative(base, target);
  // rel === "" means target === base (the directory itself).
  if (rel === "") return target;
  // A leading ".." escapes the base; an absolute rel means a different root
  // (e.g. another drive letter on Windows).
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

/**
 * Validate a single-segment file name: no directory components, no parent
 * references, no NUL bytes. Optionally enforce an allowed extension.
 *
 * @returns the safe basename, or `null` if the name is unsafe/disallowed.
 */
export function safeFileName(
  name: string,
  allowedExt?: RegExp,
): string | null {
  if (!name) return null;
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    return null;
  }
  // basename() strips any directory part; if it differs, the input was not a
  // bare file name and we reject it rather than silently "fixing" it.
  const base = path.basename(name);
  if (base !== name) return null;
  if (base === "." || base === "..") return null;
  if (allowedExt && !allowedExt.test(base)) return null;
  return base;
}
