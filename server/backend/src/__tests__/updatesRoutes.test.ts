import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { createAgentUpdateDownloadSignature } from "../wsAuth";

const storage = path.join(process.cwd(), ".test-storage-updates");
const getClient = jest.fn();
const getClients = jest.fn();
const requestClientUpdate = jest.fn();
const listPendingUpdates = jest.fn();

jest.mock("../runtimePaths", () => ({
  resolveUploadDir: () => require("path").join(process.cwd(), ".test-storage-updates"),
}));
jest.mock("../store", () => ({
  getClient: (...args: unknown[]) => getClient(...args),
  getClients: (...args: unknown[]) => getClients(...args),
}));
jest.mock("../wsHub", () => ({
  requestClientUpdate: (...args: unknown[]) => requestClientUpdate(...args),
  listPendingUpdates: (...args: unknown[]) => listPendingUpdates(...args),
  isClientConnected: () => true,
  resolveClientDownloadBase: () => "https://proctor.example.test",
}));
jest.mock("../prisma", () => ({
  prisma: {
    agentVersion: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    client: { upsert: jest.fn().mockResolvedValue({}) },
    updateDeployment: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

import updatesRouter from "../routes/updates";

const token = jwt.sign({ id: "u1", email: "admin@test", role: "ADMIN" }, "test_jwt_secret_for_jest");
function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/updates", updatesRouter);
  return instance;
}

function signedDownloadHeaders(version: string, nonce = "0123456789abcdef0123456789abcdef") {
  const clientId = "CLIENT01";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "X-Client-Id": clientId,
    "X-Client-Timestamp": timestamp,
    "X-Client-Nonce": nonce,
    "X-Client-Signature": createAgentUpdateDownloadSignature(
      clientId,
      version,
      timestamp,
      "device-key",
      nonce,
    ),
  };
}

describe("update lifecycle routes", () => {
  beforeAll(() => fs.rmSync(storage, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(storage, { recursive: true, force: true }));
  beforeEach(() => {
    getClient.mockReset().mockResolvedValue({ id: "CLIENT01", encryptionKey: "device-key" });
    getClients.mockReset().mockResolvedValue([{ id: "CLIENT01", version: "2.0.0" }]);
    requestClientUpdate.mockReset().mockResolvedValue({ queued: true, sent: true, commandId: "cmd-1" });
    listPendingUpdates.mockReset().mockResolvedValue([]);
  });

  it("requires admin auth and validates versions", async () => {
    await request(app()).get("/api/updates").expect(401);
    await request(app()).post("/api/updates").set("Authorization", `Bearer ${token}`)
      .field("version", "bad").attach("file", Buffer.from("exe"), "agent.exe").expect(400);
  });

  it("uploads, lists, deploys, downloads, and deletes an update", async () => {
    const api = app();
    const upload = await request(api).post("/api/updates").set("Authorization", `Bearer ${token}`)
      .field("version", "2.1.0").field("notes", "security release")
      .attach("file", Buffer.from("signed-executable-fixture"), "BelfProctor.exe").expect(200);
    expect(upload.body.update.sha256).toMatch(/^[a-f0-9]{64}$/);

    const list = await request(api).get("/api/updates").set("Authorization", `Bearer ${token}`).expect(200);
    expect(list.body.total).toBe(1);

    const deploy = await request(api).post("/api/updates/2.1.0/deploy")
      .set("Authorization", `Bearer ${token}`).send({ clientIds: ["CLIENT01"] }).expect(200);
    expect(deploy.body.results[0]).toMatchObject({ sent: true, commandId: "cmd-1" });
    expect(requestClientUpdate).toHaveBeenCalledWith("CLIENT01", expect.objectContaining({ version: "2.1.0" }), expect.anything());

    await request(api).get("/api/updates/2.1.0/file").expect(401);
    await request(api).get("/api/updates/2.1.0/file")
      .set("X-Client-Id", "CLIENT01").expect(401);
    const headers = signedDownloadHeaders("2.1.0");
    const download = await request(api).get("/api/updates/2.1.0/file")
      .set(headers).expect(200);
    expect(download.body).toEqual(Buffer.from("signed-executable-fixture"));
    await request(api).get("/api/updates/2.1.0/file")
      .set(headers).expect(401);
    await request(api).get("/api/updates/2.1.0/file")
      .set(signedDownloadHeaders("2.1.1", "1123456789abcdef0123456789abcdef"))
      .expect(401);

    const deployments = await request(api).get("/api/updates/deployments")
      .set("Authorization", `Bearer ${token}`).expect(200);
    expect(deployments.body.data[0].id).toBe("cmd-1");

    await request(api).delete("/api/updates/2.1.0")
      .set("Authorization", `Bearer ${token}`).expect(200, { ok: true });
  });
});
