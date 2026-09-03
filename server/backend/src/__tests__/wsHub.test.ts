import fs from "fs/promises";
import os from "os";
import path from "path";

type Handler = (...args: any[]) => void;

class FakeSocket {
  readyState = 1;
  sent: Array<{ data: unknown; options?: unknown }> = [];
  closed = false;
  handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  send(data: unknown, options?: unknown) {
    this.sent.push({ data, options });
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

describe("wsHub command, stream, and durable queues", () => {
  let uploadDir: string;
  let hub: typeof import("../wsHub");

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "belf-wshub-"));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.PUBLIC_BASE_URL = "https://proctor.example.test";
    jest.resetModules();
    hub = await import("../wsHub");
  });

  afterEach(async () => {
    delete process.env.UPLOAD_DIR;
    delete process.env.PUBLIC_BASE_URL;
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  it("uses the canonical HTTPS public URL for agent downloads", () => {
    expect(hub.getServerAddrForClient("C1")).toBe("https://proctor.example.test");
    expect(hub.resolveClientDownloadBase("C1", "10.0.0.1")).toBe(
      "https://proctor.example.test",
    );
  });

  it("registers, replaces, sends to, counts, and unregisters command sockets", async () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    hub.registerClientSocket(" C1 ", first as any, "::ffff:10.1.2.3");
    await settle();
    expect(hub.isClientConnected(" C1 ")).toBe(true);
    expect(hub.getConnectedClientCount()).toBe(1);

    hub.registerClientSocket(" C1 ", second as any, "10.1.2.4");
    await settle();
    expect(first.closed).toBe(true);
    expect(hub.sendCommandToClient("C1", "ping", { id: "fixed", x: 1 })).toBe("fixed");
    expect(JSON.parse(String(second.sent.at(-1)?.data))).toEqual({
      id: "fixed",
      type: "ping",
      payload: { id: "fixed", x: 1 },
    });

    hub.unregisterClientSocket(" C1 ", first as any);
    expect(hub.isClientConnected(" C1 ")).toBe(true);
    hub.unregisterClientSocket(" C1 ", second as any);
    expect(hub.isClientConnected(" C1 ")).toBe(false);
  });

  it("forwards binary stream frames and notifies viewers when source stops", async () => {
    const command = new FakeSocket();
    const source1 = new FakeSocket();
    const source2 = new FakeSocket();
    const viewer = new FakeSocket();
    hub.registerClientSocket("C1", command as any);
    await settle();
    hub.registerStreamViewer("C1", viewer as any, "viewer@example.test");
    expect(JSON.parse(String(command.sent.at(-1)?.data)).type).toBe("stream.start");

    hub.registerStreamSource("C1", source1 as any);
    hub.registerStreamSource("C1", source2 as any);
    expect(source1.closed).toBe(true);
    const frame = Buffer.from([1, 2, 3]);
    source2.emit("message", frame, true);
    expect(viewer.sent.some((item) => item.data === frame)).toBe(true);
    source2.emit("close");
    expect(JSON.parse(String(viewer.sent.at(-1)?.data)).type).toBe("stream.stopped");

    viewer.emit("close");
    expect(JSON.parse(String(command.sent.at(-1)?.data)).type).toBe("stream.stop");
  });

  it("queues an offline update, lists it, and delivers it on reconnect", async () => {
    const queued = await hub.requestClientUpdate("C1", {
      version: "2.0.0 beta",
      sha256: "abc",
      ignoredTransientValue: "not persisted",
    });
    expect(queued.queued).toBe(true);
    expect(queued.sent).toBe(false);
    const pending = await hub.listPendingUpdates();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ version: "2.0.0 beta", sha256: "abc" });

    const socket = new FakeSocket();
    hub.registerClientSocket("C1", socket as any, "10.0.0.2");
    await settle();
    const delivered = JSON.parse(String(socket.sent.at(-1)?.data));
    expect(delivered.type).toBe("update");
    expect(delivered.payload.downloadUrl).toBe(
      "https://proctor.example.test/api/updates/2.0.0%20beta/file",
    );
    expect(await hub.listPendingUpdates()).toEqual([]);
  });

  it("sends online update/uninstall immediately and clears durable records", async () => {
    const socket = new FakeSocket();
    hub.registerClientSocket("C1", socket as any);
    await settle();

    const update = await hub.requestClientUpdate("C1", {
      version: "3.0.0",
      sha256: "def",
    });
    expect(update).toEqual(expect.objectContaining({ queued: true, sent: true }));
    const uninstall = await hub.requestClientUninstall("C1", { reason: "retired" });
    expect(uninstall).toEqual(expect.objectContaining({ queued: true, sent: true }));
    expect(await hub.consumePendingUninstall("C1")).toBeNull();
    expect(await hub.listPendingUpdates()).toEqual([]);
  });
});
