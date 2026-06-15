import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { deleteOldFilesRecursive } from "../retention";

/**
 * File-side retention (server/client log cleanup) is pure filesystem logic and
 * is verified here without a database. The DB-side sweeps are covered by the
 * integration suite.
 */

async function makeFile(p: string, ageDays: number): Promise<void> {
  await fsPromises.mkdir(path.dirname(p), { recursive: true });
  await fsPromises.writeFile(p, "x");
  const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await fsPromises.utimes(p, when, when);
}

describe("deleteOldFilesRecursive", () => {
  let root: string;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "retention-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  it("GIVEN files of mixed age WHEN sweeping THEN only those older than the cutoff are removed", async () => {
    await makeFile(path.join(root, "old.log"), 40);
    await makeFile(path.join(root, "clients", "C1", "old.log"), 50);
    await makeFile(path.join(root, "clients", "C1", "fresh.log"), 1);

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const removed = await deleteOldFilesRecursive(root, cutoff);

    expect(removed).toBe(2);
    expect(fs.existsSync(path.join(root, "old.log"))).toBe(false);
    expect(fs.existsSync(path.join(root, "clients", "C1", "old.log"))).toBe(false);
    expect(fs.existsSync(path.join(root, "clients", "C1", "fresh.log"))).toBe(true);
  });

  it("GIVEN a missing directory WHEN sweeping THEN it returns 0 without throwing", async () => {
    const removed = await deleteOldFilesRecursive(
      path.join(root, "does-not-exist"),
      new Date(),
    );
    expect(removed).toBe(0);
  });
});
