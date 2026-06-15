import fs from "fs/promises";

/**
 * Write-a-file-then-record-it-in-the-DB is not atomic: if the DB insert fails
 * (database down, constraint violation) after the file is already on disk, the
 * file becomes an orphan — storage grows but the row never appears in any
 * listing or retention sweep.
 *
 * This helper runs the DB write and, on failure, compensates by deleting the
 * just-written file so the filesystem and database stay consistent. The unlink
 * is best-effort; the original error is always re-thrown so the caller can
 * surface a 5xx.
 *
 * @param filePath absolute path of the file already written to disk
 * @param createRecord the DB insert to attempt
 */
export async function createRecordOrUnlinkFile<T>(
  filePath: string,
  createRecord: () => Promise<T>,
): Promise<T> {
  try {
    return await createRecord();
  } catch (err) {
    await fs.unlink(filePath).catch(() => undefined);
    throw err;
  }
}
