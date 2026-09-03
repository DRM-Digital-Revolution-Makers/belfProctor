import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { encryptAes256CbcPrefixedIv } from "../encryption";

const appendHeartbeat = jest.fn();
const getClient = jest.fn();
const saveClient = jest.fn();
const getLatestHeartbeats = jest.fn();
const consumePendingUninstall = jest.fn();
const updateMany = jest.fn();

jest.mock("../store", () => ({
  appendHeartbeat: (...args: unknown[]) => appendHeartbeat(...args),
  getClient: (...args: unknown[]) => getClient(...args),
  saveClient: (...args: unknown[]) => saveClient(...args),
  getLatestHeartbeats: (...args: unknown[]) => getLatestHeartbeats(...args),
}));
jest.mock("../wsHub", () => ({
  consumePendingUninstall: (...args: unknown[]) => consumePendingUninstall(...args),
}));
jest.mock("../prisma", () => ({
  prisma: { updateDeployment: { updateMany: (...args: unknown[]) => updateMany(...args) } },
}));
jest.mock("../serverTime", () => ({ now: () => new Date("2026-09-01T12:00:00.000Z") }));

import heartbeatRouter from "../routes/heartbeat";

const key = "unique-heartbeat-device-key-32-bytes";
const token = jwt.sign({ id: "u1", email: "admin@test", role: "ADMIN" }, "test_jwt_secret_for_jest");

function app() {
  const instance = express();
  instance.use("/api/heartbeat", express.raw({ type: "application/octet-stream" }));
  instance.use("/api/heartbeat", heartbeatRouter);
  return instance;
}

describe("heartbeat routes", () => {
  beforeEach(() => {
    appendHeartbeat.mockReset().mockResolvedValue(undefined);
    getClient.mockReset().mockResolvedValue({ id: "CLIENT01", encryptionKey: key, hostname: "old" });
    saveClient.mockReset().mockResolvedValue(undefined);
    getLatestHeartbeats.mockReset().mockResolvedValue([{ clientId: "CLIENT01" }]);
    consumePendingUninstall.mockReset().mockResolvedValue(null);
    updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("ingests authenticated AEAD heartbeat and confirms update", async () => {
    const body = encryptAes256CbcPrefixedIv(Buffer.from(JSON.stringify({
      Machine: "PC-01", OS: "Windows", Version: "2.1.0", Status: "Online",
    })), key);
    await request(app()).post("/api/heartbeat").set("X-Client-Id", "CLIENT01")
      .set("Content-Type", "application/octet-stream").send(body).expect(200, { ok: true });
    expect(saveClient).toHaveBeenCalledWith(expect.objectContaining({ id: "CLIENT01", hostname: "PC-01" }));
    expect(appendHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ version: "2.1.0" }));
    expect(updateMany).toHaveBeenCalled();
  });

  it("returns pending uninstall instruction", async () => {
    consumePendingUninstall.mockResolvedValue({ id: "cmd-1" });
    const body = encryptAes256CbcPrefixedIv(Buffer.from('{"Status":"Online"}'), key);
    const response = await request(app()).post("/api/heartbeat").set("X-Client-Id", "CLIENT01")
      .set("Content-Type", "application/octet-stream").send(body).expect(200);
    expect(response.body.uninstall).toEqual({ id: "cmd-1" });
  });

  it("rejects tampered ciphertext", async () => {
    const body = encryptAes256CbcPrefixedIv(Buffer.from("{}"), key);
    body[body.length - 1] ^= 1;
    await request(app()).post("/api/heartbeat").set("X-Client-Id", "CLIENT01")
      .set("Content-Type", "application/octet-stream").send(body).expect(400);
    expect(appendHeartbeat).not.toHaveBeenCalled();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("does not create an unknown client before cryptographic authentication", async () => {
    getClient.mockResolvedValue(null);
    await request(app()).post("/api/heartbeat").set("X-Client-Id", "UNTRUSTED01")
      .set("Content-Type", "application/octet-stream").send(Buffer.from("not-authenticated"))
      .expect(400);
    expect(saveClient).not.toHaveBeenCalled();
    expect(appendHeartbeat).not.toHaveBeenCalled();
  });

  it("protects and serves administrative heartbeat views", async () => {
    await request(app()).get("/api/heartbeat").expect(401);
    const response = await request(app()).get("/api/heartbeat/latest")
      .set("Authorization", `Bearer ${token}`).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.serverTime).toBeTruthy();
  });
});
