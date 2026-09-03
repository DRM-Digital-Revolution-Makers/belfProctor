import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { config } from "../config";

const storage = path.join(process.cwd(), ".test-storage-files");
const deviceKey = "unique-device-credential-with-more-than-32-bytes";
const getClient = jest.fn();
const saveClient = jest.fn();
const screenshotCreate = jest.fn();
const reportCreate = jest.fn();
const setFavorite = jest.fn();
const listReports = jest.fn();
const screenshotFindMany = jest.fn();
const screenshotCount = jest.fn();
const clientFindMany = jest.fn();

jest.mock("../runtimePaths", () => ({
  resolveUploadDir: () => require("path").join(process.cwd(), ".test-storage-files"),
}));
jest.mock("../store", () => ({
  getClient: (...args: unknown[]) => getClient(...args),
  saveClient: (...args: unknown[]) => saveClient(...args),
  setFavorite: (...args: unknown[]) => setFavorite(...args),
}));
jest.mock("../services/reportStore", () => ({
  listReports: (...args: unknown[]) => listReports(...args),
  reportsRootDir: (root: string) => require("path").join(root, "reports"),
  reportJsonToCsv: (content: string) => content,
}));
jest.mock("../prisma", () => ({
  prisma: {
    client: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: (...args: unknown[]) => clientFindMany(...args),
    },
    screenshot: {
      create: (...args: unknown[]) => screenshotCreate(...args),
      findMany: (...args: unknown[]) => screenshotFindMany(...args),
      count: (...args: unknown[]) => screenshotCount(...args),
    },
    report: {
      create: (...args: unknown[]) => reportCreate(...args),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

import filesRouter from "../routes/files";
import { encryptAes256CbcPrefixedIv } from "../encryption";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", filesRouter);
  return instance;
}

function authHeader() {
  return `Bearer ${jwt.sign({ id: "u1", email: "admin@test", role: "ADMIN" }, config.jwtSecret)}`;
}

function viewerAuthHeader() {
  return `Bearer ${jwt.sign({ id: "u2", email: "viewer@test", role: "VIEWER" }, config.jwtSecret)}`;
}

describe("encrypted file ingestion", () => {
  beforeAll(() => fs.rmSync(storage, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(storage, { recursive: true, force: true }));

  beforeEach(() => {
    getClient.mockReset().mockResolvedValue({ id: "CLIENT01", encryptionKey: deviceKey });
    saveClient.mockReset().mockResolvedValue(undefined);
    screenshotCreate.mockReset().mockResolvedValue({ id: "shot-1" });
    reportCreate.mockReset().mockResolvedValue({ id: 42 });
    setFavorite.mockReset().mockResolvedValue(undefined);
    listReports.mockReset().mockResolvedValue({ data: [], total: 0 });
    screenshotFindMany.mockReset().mockResolvedValue([]);
    screenshotCount.mockReset().mockResolvedValue(0);
    clientFindMany.mockReset().mockResolvedValue([]);
  });

  it("decrypts and indexes an authenticated screenshot payload", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x42, 0x50, 0xff, 0xd9]);
    const encrypted = encryptAes256CbcPrefixedIv(jpeg, deviceKey);

    const response = await request(app())
      .post("/api/screenshots")
      .field("clientId", "CLIENT01")
      .field("timestamp", "2026-08-31T10:00:00.000Z")
      .field("captureReason", "test")
      .attach("screenshot", encrypted, "capture.bin")
      .expect(200);

    expect(response.body.ok).toBe(true);
    const written = screenshotCreate.mock.calls[0][0].data.path as string;
    expect(fs.readFileSync(written)).toEqual(jpeg);
    expect(screenshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: "CLIENT01", captureReason: "test" }),
    });
  });

  it("rejects a tampered AEAD screenshot and does not index it", async () => {
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.from("image"), deviceKey);
    encrypted[encrypted.length - 1] ^= 0xff;

    await request(app())
      .post("/api/screenshots")
      .field("clientId", "CLIENT01")
      .attach("screenshot", encrypted, "capture.bin")
      .expect(400, { message: "Decryption failed" });

    expect(screenshotCreate).not.toHaveBeenCalled();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("does not create an unknown client before screenshot authentication", async () => {
    getClient.mockResolvedValue(null);
    await request(app())
      .post("/api/screenshots")
      .field("clientId", "UNTRUSTED01")
      .attach("screenshot", Buffer.from("not-authenticated"), "capture.bin")
      .expect(400, { message: "Decryption failed" });
    expect(saveClient).not.toHaveBeenCalled();
    expect(screenshotCreate).not.toHaveBeenCalled();
  });

  it("decrypts and persists a JSON report", async () => {
    const report = Buffer.from(JSON.stringify({ processes: [{ name: "editor" }] }));
    const encrypted = encryptAes256CbcPrefixedIv(report, deviceKey);

    const response = await request(app())
      .post("/api/reports")
      .field("clientId", "CLIENT01")
      .attach("report", encrypted, "report.bin")
      .expect(200);

    expect(response.body.id).toBe(42);
    const written = reportCreate.mock.calls[0][0].data.path as string;
    expect(fs.readFileSync(written)).toEqual(report);
    expect(reportCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ clientId: "CLIENT01" }),
    });
  });

  it("does not create an unknown client from an unauthenticated report", async () => {
    getClient.mockResolvedValue(null);
    await request(app())
      .post("/api/reports")
      .field("clientId", "UNTRUSTED01")
      .attach("report", Buffer.from("not-authenticated"), "report.bin")
      .expect(400, { message: "Client not registered or missing key" });
    expect(saveClient).not.toHaveBeenCalled();
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a tampered report without persistence", async () => {
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.from("{}"), deviceKey);
    encrypted[encrypted.length - 1] ^= 1;
    await request(app())
      .post("/api/reports")
      .field("clientId", "CLIENT01")
      .attach("report", encrypted, "report.bin")
      .expect(400, { message: "Decryption failed" });
    expect(reportCreate).not.toHaveBeenCalled();
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("decrypts a command result and serves the newest result to an admin", async () => {
    const result = Buffer.from("command output");
    const encrypted = encryptAes256CbcPrefixedIv(result, deviceKey);

    const upload = await request(app())
      .post("/api/commands/cmd-7/result")
      .field("clientId", "CLIENT01")
      .field("timestamp", "2026-08-31T10:00:00.000Z")
      .attach("file", encrypted, "result.bin")
      .expect(200);
    expect(upload.body).toEqual({ ok: true });
    const commandDir = path.join(storage, "commands", "CLIENT01");
    const stored = fs.readdirSync(commandDir).find((name) => name.startsWith("cmd-7_"));
    expect(stored).toBeTruthy();
    expect(fs.readFileSync(path.join(commandDir, stored!))).toEqual(result);

    const download = await request(app())
      .get("/api/commands/cmd-7/file/latest")
      .set("Authorization", authHeader())
      .expect(200);
    expect(download.body).toEqual(result);

    await request(app())
      .get("/api/commands/cmd-7/file/latest")
      .set("Authorization", viewerAuthHeader())
      .expect(403, { message: "Administrator role required" });

    await request(app())
      .get("/api/commands/missing/file/latest")
      .set("Authorization", authHeader())
      .expect(202, { message: "Pending" });
  });

  it("does not create an unknown client from an unauthenticated command result", async () => {
    getClient.mockResolvedValue(null);
    await request(app())
      .post("/api/commands/cmd-untrusted/result")
      .field("clientId", "UNTRUSTED01")
      .attach("file", Buffer.from("not-authenticated"), "result.bin")
      .expect(400, { message: "Client not registered or missing key" });
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("rejects a tampered command result without updating client state", async () => {
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.from("result"), deviceKey);
    encrypted[encrypted.length - 1] ^= 1;
    await request(app())
      .post("/api/commands/cmd-tampered/result")
      .field("clientId", "CLIENT01")
      .attach("file", encrypted, "result.bin")
      .expect(400, { message: "Decryption failed" });
    expect(saveClient).not.toHaveBeenCalled();
  });

  it("rejects an unsafe command id before persisting a result", async () => {
    const encrypted = encryptAes256CbcPrefixedIv(Buffer.from("no traversal"), deviceKey);
    await request(app())
      .post("/api/commands/..%5Cescape/result")
      .field("clientId", "CLIENT01")
      .attach("file", encrypted, "result.bin")
      .expect(400, { message: "Invalid command id" });
  });

  it("lists and filters indexed screenshots and reports for admins", async () => {
    const timestamp = new Date("2026-08-31T10:00:00.000Z");
    screenshotFindMany.mockResolvedValueOnce([{
      clientId: "CLIENT01", filename: "capture.jpg", path: "x", timestamp, isFavorite: true,
    }]);
    screenshotCount.mockResolvedValueOnce(1);
    clientFindMany.mockResolvedValueOnce([{ id: "CLIENT01" }]);

    const screenshots = await request(app())
      .get("/api/screenshots?clientId=CLIENT01&category=lab&isFavorite=true&date=2026-08-31&pageSize=999")
      .set("Authorization", authHeader())
      .expect(200);
    expect(screenshots.body).toMatchObject({ total: 1, data: [{ id: "capture.jpg", clientId: "CLIENT01" }] });
    expect(screenshotFindMany.mock.calls[0][0].take).toBe(200);

    await request(app())
      .get("/api/reports?clientId=CLIENT01&date=2026-08-31&page=2&pageSize=10")
      .set("Authorization", authHeader())
      .expect(200, { data: [], total: 0 });
    expect(listReports).toHaveBeenCalledWith(expect.objectContaining({ clientId: "CLIENT01", page: 2, pageSize: 10 }));
  });

  it("updates favorites and validates report download identifiers", async () => {
    await request(app())
      .put("/api/screenshots/shot-1/favorite")
      .set("Authorization", authHeader())
      .send({ isFavorite: true })
      .expect(200, { ok: true });
    expect(setFavorite).toHaveBeenCalledWith("shot-1", true);

    await request(app()).get("/api/reports/not-a-number/file")
      .set("Authorization", authHeader()).expect(400);
    await request(app()).get("/api/reports/not-a-number/csv")
      .set("Authorization", authHeader()).expect(400);
  });
});
