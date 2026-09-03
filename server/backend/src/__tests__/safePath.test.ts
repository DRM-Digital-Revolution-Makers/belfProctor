import path from "path";
import { resolveWithinDir, safeFileName } from "../util/safePath";

describe("resolveWithinDir", () => {
  const base = path.resolve("/srv/storage/screenshots");

  it("GIVEN a normal child WHEN resolving THEN it returns an absolute path inside base", () => {
    const out = resolveWithinDir(base, "CLIENT01", "shot.jpg");
    expect(out).not.toBeNull();
    expect(out!.startsWith(base)).toBe(true);
  });

  it("GIVEN the base itself WHEN resolving with no segments THEN it returns base", () => {
    expect(resolveWithinDir(base)).toBe(base);
  });

  it.each([
    ["parent escape", ["..", "..", "etc", "passwd"]],
    ["embedded escape", ["CLIENT01", "..", "..", "..", "secret"]],
    ["single parent", [".."]],
  ])("GIVEN a traversal (%s) WHEN resolving THEN it returns null", (_label, segs) => {
    expect(resolveWithinDir(base, ...(segs as string[]))).toBeNull();
  });

  it("GIVEN an absolute segment WHEN resolving THEN it returns null (cannot escape via absolute)", () => {
    // An absolute POSIX path as a later segment would reset the resolution.
    const out = resolveWithinDir(base, "/etc/passwd");
    expect(out).toBeNull();
  });
});

describe("safeFileName", () => {
  it("GIVEN a valid screenshot name WHEN validating THEN it is accepted", () => {
    const name = "CLIENT01_2026-06-15T10-30-00.000Z.jpg";
    expect(safeFileName(name, /\.(jpe?g|png)$/i)).toBe(name);
  });

  it.each([
    "../../etc/passwd",
    "..\\..\\windows\\system32\\config\\sam",
    "sub/dir/file.jpg",
    "file\0.jpg",
    "..",
    ".",
  ])("GIVEN an unsafe name (%s) WHEN validating THEN it is rejected", (name) => {
    expect(safeFileName(name)).toBeNull();
  });

  it("GIVEN a name with a disallowed extension WHEN validating THEN it is rejected", () => {
    expect(safeFileName("shot.exe", /\.(jpe?g|png)$/i)).toBeNull();
  });

  it("GIVEN an empty name WHEN validating THEN it is rejected", () => {
    expect(safeFileName("")).toBeNull();
  });
});
