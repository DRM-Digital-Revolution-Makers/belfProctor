/**
 * Verifies that AppStat is updated only for foreground AppUsage events
 * and not for noisy ProcessStarted events.
 */
import express from "express";
import request from "supertest";
import { encryptAes256CbcPrefixedIv } from "../encryption";

jest.mock("../store", () => ({
  appendEvent: jest.fn().mockResolvedValue(undefined),
  upsertAppStat: jest.fn().mockResolvedValue(undefined),
  getAppStats: jest.fn().mockResolvedValue([]),
  getClient: jest.fn().mockResolvedValue({
    id: "CLIENT_TEST",
    encryptionKey: "test_key_for_jest_unit_tests",
  }),
  saveClient: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../prisma", () => ({
  prisma: {},
}));

import { appendEvent, upsertAppStat } from "../store";
import eventsRouter from "../routes/events";

function buildApp() {
  const app = express();
  app.use(
    "/api/events",
    express.raw({ type: "application/octet-stream", limit: "10mb" }),
  );
  app.use("/api/events", eventsRouter);
  return app;
}

function encrypted(payload: unknown): Buffer {
  return encryptAes256CbcPrefixedIv(
    Buffer.from(JSON.stringify(payload), "utf8"),
    "test_key_for_jest_unit_tests",
  );
}

describe("POST /api/events — AppStat filtering", () => {
  beforeEach(() => {
    (appendEvent as jest.Mock).mockClear();
    (upsertAppStat as jest.Mock).mockClear();
  });

  it("does NOT call upsertAppStat for ProcessStarted", async () => {
    const app = buildApp();
    const body = encrypted({
      EventType: "ProcessStarted",
      ProcessName: "svchost.exe",
      Timestamp: new Date().toISOString(),
    });

    await request(app)
      .post("/api/events")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(upsertAppStat).not.toHaveBeenCalled();
    // ProcessStarted is hidden from main log — appendEvent must not be called
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("DOES call upsertAppStat for AppUsage", async () => {
    const app = buildApp();
    const body = encrypted({
      EventType: "AppUsage",
      ProcessName: "chrome.exe",
      Timestamp: new Date().toISOString(),
    });

    await request(app)
      .post("/api/events")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream")
      .send(body)
      .expect(200);

    expect(upsertAppStat).toHaveBeenCalledTimes(1);
    expect(upsertAppStat).toHaveBeenCalledWith(
      "CLIENT_TEST",
      "chrome.exe",
      expect.any(Date),
    );
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
});
