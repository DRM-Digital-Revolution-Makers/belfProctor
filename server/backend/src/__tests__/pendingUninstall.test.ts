import fsPromises from "fs/promises";
import os from "os";
import path from "path";

/**
 * The uninstall command must be delivered exactly once even when the heartbeat
 * path and a WebSocket reconnect try to consume it at the same time [B-M5].
 * consumePendingUninstall claims the record with an atomic rename, so only one
 * concurrent caller can win.
 */
describe("consumePendingUninstall — atomic once-only delivery", () => {
  let dir: string;
  let wsHub: typeof import("../wsHub");

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "wshub-test-"));
    process.env.UPLOAD_DIR = dir;
    jest.resetModules();
    wsHub = await import("../wsHub");
  });

  afterEach(async () => {
    delete process.env.UPLOAD_DIR;
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  it("GIVEN a queued uninstall WHEN three consumers race THEN exactly one is delivered", async () => {
    await wsHub.requeuePendingUninstall("C1", "cmd-1", { reason: "test" });

    const results = await Promise.all([
      wsHub.consumePendingUninstall("C1"),
      wsHub.consumePendingUninstall("C1"),
      wsHub.consumePendingUninstall("C1"),
    ]);

    const delivered = results.filter((r) => r?.id === "cmd-1");
    expect(delivered).toHaveLength(1);

    // And the record is gone afterwards.
    expect(await wsHub.consumePendingUninstall("C1")).toBeNull();
  });

  it("GIVEN nothing queued WHEN consuming THEN it returns null", async () => {
    expect(await wsHub.consumePendingUninstall("nobody")).toBeNull();
  });
});
