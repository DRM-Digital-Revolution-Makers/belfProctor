import express from "express";
import request from "supertest";
import { encryptAes256CbcPrefixedIv } from "../encryption";

const upsertMock = jest.fn();
const findUniqueMock = jest.fn();
const updateMock = jest.fn();
const createMock = jest.fn();
const findManyMock = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    pcSession: {
      upsert: (...a: unknown[]) => upsertMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
      create: (...a: unknown[]) => createMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
    },
  },
}));

jest.mock("../store", () => ({
  getClient: jest.fn().mockResolvedValue({
    id: "CLIENT_TEST",
    encryptionKey: "test_key_for_jest_unit_tests",
  }),
  saveClient: jest.fn().mockResolvedValue(undefined),
}));

import pcSessionRouter from "../routes/pcSession";

function buildApp() {
  const app = express();
  app.use(
    "/api/pc-session",
    express.raw({ type: "application/octet-stream", limit: "256kb" }),
  );
  app.use("/api/pc-session", pcSessionRouter);
  return app;
}

function encrypted(payload: unknown): Buffer {
  return encryptAes256CbcPrefixedIv(
    Buffer.from(JSON.stringify(payload), "utf8"),
    "test_key_for_jest_unit_tests",
  );
}

describe("POST /api/pc-session", () => {
  beforeEach(() => {
    upsertMock.mockReset().mockResolvedValue(undefined);
    findUniqueMock.mockReset();
    updateMock.mockReset().mockResolvedValue(undefined);
    createMock.mockReset().mockResolvedValue(undefined);
    findManyMock.mockReset().mockResolvedValue([]);
  });

  it("Boot is idempotent on bootId", async () => {
    const app = buildApp();
    const body = encrypted({
      Kind: "Boot",
      BootId: "boot-1",
      TimestampUtc: "2026-06-11T08:00:00.000Z",
    });

    await request(app)
      .post("/api/pc-session")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    await request(app)
      .post("/api/pc-session")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(upsertMock).toHaveBeenCalledTimes(2);
    // Both calls use the same bootId so the second is a no-op upsert.
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      where: { bootId: "boot-1" },
      create: expect.objectContaining({
        clientId: "CLIENT_TEST",
        source: "explicit",
        bootId: "boot-1",
      }),
    });
  });

  it("Shutdown updates the matching open session", async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: "sess-1",
      bootId: "boot-1",
      shutdownAt: null,
    });

    const app = buildApp();
    const body = encrypted({
      Kind: "Shutdown",
      BootId: "boot-1",
      TimestampUtc: "2026-06-11T17:00:00.000Z",
    });

    await request(app)
      .post("/api/pc-session")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(updateMock).toHaveBeenCalledWith({
      where: { bootId: "boot-1" },
      data: { shutdownAt: new Date("2026-06-11T17:00:00.000Z") },
    });
  });

  it("Shutdown without prior Boot creates a self-closing session", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const app = buildApp();
    const body = encrypted({
      Kind: "Shutdown",
      BootId: "boot-2",
      TimestampUtc: "2026-06-11T17:00:00.000Z",
    });

    await request(app)
      .post("/api/pc-session")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(createMock).toHaveBeenCalledWith({
      data: {
        clientId: "CLIENT_TEST",
        bootAt: new Date("2026-06-11T17:00:00.000Z"),
        shutdownAt: new Date("2026-06-11T17:00:00.000Z"),
        source: "explicit",
        bootId: "boot-2",
      },
    });
  });

  it("rejects payload without bootId", async () => {
    const app = buildApp();
    const body = encrypted({ Kind: "Boot", TimestampUtc: "2026-06-11T08:00:00.000Z" });

    await request(app)
      .post("/api/pc-session")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(400);
  });
});
