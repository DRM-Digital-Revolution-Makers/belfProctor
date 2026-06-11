import express from "express";
import request from "supertest";
import { encryptAes256CbcPrefixedIv } from "../encryption";

const createMock = jest.fn();
const findManyMock = jest.fn();
const groupByMock = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    browserActivity: {
      create: (...a: unknown[]) => createMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
      groupBy: (...a: unknown[]) => groupByMock(...a),
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

import browserActivityRouter from "../routes/browserActivity";

function buildApp() {
  const app = express();
  app.use(
    "/api/browser-activity",
    express.raw({ type: "application/octet-stream", limit: "5mb" }),
  );
  app.use("/api/browser-activity", browserActivityRouter);
  return app;
}

function encrypted(payload: unknown): Buffer {
  return encryptAes256CbcPrefixedIv(
    Buffer.from(JSON.stringify(payload), "utf8"),
    "test_key_for_jest_unit_tests",
  );
}

describe("POST /api/browser-activity", () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue(undefined);
    findManyMock.mockReset();
    groupByMock.mockReset();
  });

  it("extracts domains and inserts each row (one prisma.create per visit)", async () => {
    const app = buildApp();
    const body = encrypted([
      {
        Url: "https://www.example.com/some/page?q=1",
        Title: "Example",
        Browser: "Chrome",
        Profile: "Default",
        VisitedAtUtc: "2026-06-11T10:00:00.000Z",
      },
      {
        Url: "https://docs.google.com/document/d/123",
        Title: "Doc",
        Browser: "Chrome",
        Profile: "Default",
        VisitedAtUtc: "2026-06-11T10:05:00.000Z",
      },
    ]);

    const res = await request(app)
      .post("/api/browser-activity")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ ok: true, inserted: 2 });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      clientId: "CLIENT_TEST",
      url: "https://www.example.com/some/page?q=1",
      domain: "www.example.com",
      browser: "chrome",
      profile: "Default",
      title: "Example",
    });
    expect(createMock.mock.calls[1][0].data.domain).toBe("docs.google.com");
  });

  it("drops invalid URLs and empty rows", async () => {
    const app = buildApp();
    const body = encrypted([
      {
        Url: "not a url",
        Browser: "Chrome",
        VisitedAtUtc: "2026-06-11T10:00:00.000Z",
      },
      {
        // missing url
        Browser: "Chrome",
        VisitedAtUtc: "2026-06-11T10:01:00.000Z",
      },
      {
        Url: "https://valid.example/",
        Browser: "Chrome",
        VisitedAtUtc: "2026-06-11T10:02:00.000Z",
      },
    ]);

    await request(app)
      .post("/api/browser-activity")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.domain).toBe("valid.example");
  });

  it("swallows P2002 duplicate-key errors without failing the batch", async () => {
    createMock.mockReset();
    // First insert succeeds, second is a duplicate (P2002), third succeeds.
    createMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
      .mockResolvedValueOnce(undefined);

    const app = buildApp();
    const body = encrypted([
      { Url: "https://a.example/", Browser: "Chrome", VisitedAtUtc: "2026-06-11T10:00:00Z" },
      { Url: "https://b.example/", Browser: "Chrome", VisitedAtUtc: "2026-06-11T10:01:00Z" },
      { Url: "https://c.example/", Browser: "Chrome", VisitedAtUtc: "2026-06-11T10:02:00Z" },
    ]);

    const res = await request(app)
      .post("/api/browser-activity")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ ok: true, inserted: 2 });
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("returns 0 inserted when there are no usable rows", async () => {
    const app = buildApp();
    const body = encrypted([]);

    const res = await request(app)
      .post("/api/browser-activity")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ ok: true, inserted: 0 });
    expect(createMock).not.toHaveBeenCalled();
  });
});
