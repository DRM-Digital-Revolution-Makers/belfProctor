import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { encryptAes256CbcPrefixedIv } from "../encryption";

const appendActivity = jest.fn();
const getClient = jest.fn();
const saveClient = jest.fn();
const getLatestActivity = jest.fn();
const getLatestActivityPerClient = jest.fn();
const ingest = jest.fn();

jest.mock("../store", () => ({
  appendActivity: (...args: unknown[]) => appendActivity(...args),
  getClient: (...args: unknown[]) => getClient(...args),
  saveClient: (...args: unknown[]) => saveClient(...args),
  getLatestActivity: (...args: unknown[]) => getLatestActivity(...args),
  getLatestActivityPerClient: (...args: unknown[]) => getLatestActivityPerClient(...args),
  ingestActivityToTimesheetAndClient: (...args: unknown[]) => ingest(...args),
}));
jest.mock("../serverTime", () => ({
  now: () => new Date("2026-09-01T12:00:00.000Z"),
  reconcile: (date: Date | null) => date || new Date("2026-09-01T12:00:00.000Z"),
}));

import activityRouter from "../routes/activity";

const key = "unique-activity-device-key-32-bytes";
const token = jwt.sign({ id: "u1", email: "admin@test", role: "ADMIN" }, "test_jwt_secret_for_jest");

function app() {
  const instance = express();
  instance.use("/api/activity", express.raw({ type: "application/octet-stream" }));
  instance.use("/api/activity", activityRouter);
  return instance;
}

describe("activity routes", () => {
  beforeEach(() => {
    appendActivity.mockReset().mockResolvedValue(undefined);
    getClient.mockReset().mockResolvedValue({ id: "CLIENT01", encryptionKey: key });
    saveClient.mockReset().mockResolvedValue(undefined);
    getLatestActivity.mockReset().mockResolvedValue([{ clientId: "CLIENT01" }]);
    getLatestActivityPerClient.mockReset().mockResolvedValue([{ clientId: "CLIENT01" }]);
    ingest.mockReset().mockResolvedValue(undefined);
  });

  it("ingests AEAD activity and normalizes timestamps without offsets as UTC", async () => {
    const body = encryptAes256CbcPrefixedIv(Buffer.from(JSON.stringify({
      Timestamp: "2026-09-01T10:30:00", IsActive: true,
      ActiveMilliseconds: 4500, InactiveMilliseconds: 500,
    })), key);
    await request(app()).post("/api/activity").set("X-Client-Id", "CLIENT01")
      .set("Content-Type", "application/octet-stream").send(body).expect(200, { id: "file-saved" });
    expect(ingest).toHaveBeenCalledWith("CLIENT01", key, expect.any(Date),
      new Date("2026-09-01T10:30:00.000Z"), 4500, 500);
    expect(appendActivity).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("rejects a payload signed with another device credential", async () => {
    const body = encryptAes256CbcPrefixedIv(Buffer.from("{}"), "wrong-device-key-that-is-32-bytes");
    await request(app()).post("/api/activity").set("X-Client-Id", "CLIENT01")
      .set("Content-Type", "application/octet-stream").send(body).expect(400);
    expect(appendActivity).not.toHaveBeenCalled();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("protects admin list and bounds both latest query modes", async () => {
    await request(app()).get("/api/activity").expect(401);
    await request(app()).get("/api/activity/latest?global=1&limit=99999")
      .set("Authorization", `Bearer ${token}`).expect(200);
    expect(getLatestActivity).toHaveBeenCalledWith(500);
    await request(app()).get("/api/activity/latest?clients=99999")
      .set("Authorization", `Bearer ${token}`).expect(200);
    expect(getLatestActivityPerClient).toHaveBeenCalledWith(5000);
  });
});
