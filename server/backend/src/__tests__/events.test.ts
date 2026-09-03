/**
 * Verifies that AppStat is updated only for foreground AppUsage events
 * and not for noisy ProcessStarted events.
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config } from "../config";
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
  prisma: {
    event: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { appendEvent, upsertAppStat, getAppStats } from "../store";
import { prisma } from "../prisma";
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

  it("ingests an array including numeric event types", async () => {
    const body = encrypted([
      { EventType: 2, DeviceId: "USB-1", Description: "connected" },
      { eventType: "SystemError", description: "failure" },
    ]);
    const response = await request(buildApp()).post("/api/events")
      .set("X-Client-Id", "CLIENT_TEST")
      .set("Content-Type", "application/octet-stream").send(body).expect(200);
    expect(response.body).toEqual({ count: 2 });
    expect(appendEvent).toHaveBeenCalledTimes(2);
  });

  it("serves sorted stats and bounded paginated events to admins", async () => {
    (getAppStats as jest.Mock).mockResolvedValueOnce([
      { name: "low", count: 1 }, { name: "high", count: 5 },
    ]);
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([[{ id: "e1" }], 1]);
    const token = `Bearer ${jwt.sign({ id: "u1", role: "ADMIN" }, config.jwtSecret)}`;
    const stats = await request(buildApp()).get("/api/events/stats")
      .set("Authorization", token).expect(200);
    expect(stats.body.map((x: any) => x.name)).toEqual(["high", "low"]);
    const list = await request(buildApp()).get("/api/events?page=2&pageSize=999&clientId=CLIENT_TEST")
      .set("Authorization", token).expect(200);
    expect(list.body).toEqual({ data: [{ id: "e1" }], total: 1 });
    expect((prisma.event.findMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { clientId: "CLIENT_TEST" }, skip: 50, take: 50,
    });
  });
});
