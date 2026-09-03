import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../config";

const getUser = jest.fn();
const deleteClient = jest.fn();
const requestClientUninstall = jest.fn();

jest.mock("../store", () => ({
  deleteClient: (...args: unknown[]) => deleteClient(...args),
  streamDailyActivitySummary: jest.fn(),
  streamMonthlyActivitySummary: jest.fn(),
  streamAppCounts: jest.fn(),
  getTimesheetDataForMonth: jest.fn(),
  getUser: (...args: unknown[]) => getUser(...args),
}));
jest.mock("../wsHub", () => ({
  requestClientUninstall: (...args: unknown[]) => requestClientUninstall(...args),
}));
import clientDeletionRouter from "../routes/clientDeletion";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/clients", clientDeletionRouter);
  return instance;
}

function token(role: "ADMIN" | "VIEWER") {
  return jwt.sign({ id: "u1", email: "admin@test", role }, config.jwtSecret);
}

describe("destructive client deletion re-authentication", () => {
  beforeEach(async () => {
    deleteClient.mockReset().mockResolvedValue(undefined);
    requestClientUninstall.mockReset().mockResolvedValue({ id: "uninstall-1" });
    getUser.mockReset().mockResolvedValue({
      email: "admin@test",
      passwordHash: await bcrypt.hash("correct-password", 4),
    });
  });

  it("requires ADMIN before password verification", async () => {
    await request(app()).delete("/api/clients/CLIENT01").expect(401);
    await request(app()).delete("/api/clients/CLIENT01")
      .set("Authorization", `Bearer ${token("VIEWER")}`)
      .send({ password: "correct-password" }).expect(403);
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it("accepts the password only in JSON body and rejects the removed header fallback", async () => {
    await request(app()).delete("/api/clients/CLIENT01")
      .set("Authorization", `Bearer ${token("ADMIN")}`)
      .set("X-Admin-Password", "correct-password").expect(400, { message: "Password required" });
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it("deletes only after successful ADMIN re-authentication", async () => {
    await request(app()).delete("/api/clients/CLIENT01")
      .set("Authorization", `Bearer ${token("ADMIN")}`)
      .send({ password: "correct-password" }).expect(200);
    expect(requestClientUninstall).toHaveBeenCalledWith("CLIENT01", { serviceName: "BelfProctor" });
    expect(deleteClient).toHaveBeenCalledWith("CLIENT01");
  });

  it("rejects an incorrect re-authentication password", async () => {
    await request(app()).delete("/api/clients/CLIENT01")
      .set("Authorization", `Bearer ${token("ADMIN")}`)
      .send({ password: "incorrect-password" }).expect(403, { message: "Invalid password" });
    expect(deleteClient).not.toHaveBeenCalled();
  });
});
