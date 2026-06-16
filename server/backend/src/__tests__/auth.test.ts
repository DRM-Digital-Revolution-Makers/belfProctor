import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config";

const getUserMock = jest.fn();
jest.mock("../store", () => ({
  getUser: (...a: unknown[]) => getUserMock(...a),
}));

import authRouter from "../routes/auth";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  return app;
}

const PASSWORD = "correct-horse-battery-staple";
let passwordHash = "";

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

beforeEach(() => {
  getUserMock.mockReset();
});

describe("POST /api/auth/login", () => {
  it("GIVEN valid credentials WHEN logging in THEN returns a JWT signed with the configured secret", async () => {
    getUserMock.mockResolvedValueOnce({
      id: 1,
      email: "admin@local",
      passwordHash,
      role: "ADMIN",
    });

    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "admin@local", password: PASSWORD })
      .expect(200);

    expect(typeof res.body.token).toBe("string");
    const payload = jwt.verify(res.body.token, config.jwtSecret) as {
      email: string;
      role: string;
    };
    expect(payload.email).toBe("admin@local");
    expect(payload.role).toBe("ADMIN");
  });

  it("GIVEN a wrong password WHEN logging in THEN returns 401", async () => {
    getUserMock.mockResolvedValueOnce({
      id: 1,
      email: "admin@local",
      passwordHash,
      role: "ADMIN",
    });

    await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "admin@local", password: "wrong" })
      .expect(401);
  });

  it("GIVEN an unknown user WHEN logging in THEN returns 401", async () => {
    getUserMock.mockResolvedValueOnce(undefined);

    await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "nobody@local", password: PASSWORD })
      .expect(401);
  });

  it("GIVEN missing fields WHEN logging in THEN returns 400", async () => {
    await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "admin@local" })
      .expect(400);
  });
});
