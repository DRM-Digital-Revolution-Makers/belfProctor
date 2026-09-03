import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";

const getUserMock = jest.fn();
jest.mock("../store", () => ({
  getUser: (...a: unknown[]) => getUserMock(...a),
}));

import authRouter from "../routes/auth";
import { extractAuthToken } from "../middleware/auth";

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
  it("does not accept a session token from the URL query string", () => {
    const requestLike = {
      headers: {},
      query: { token: "must-not-be-read-from-url" },
    } as any;
    expect(extractAuthToken(requestLike)).toBe("");
  });

  it("GIVEN valid credentials WHEN logging in THEN sets an HttpOnly session cookie", async () => {
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

    expect(res.body).toEqual({ ok: true });
    const cookie = res.headers["set-cookie"]?.[0] || "";
    expect(cookie).toContain("bp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(res.text).not.toContain("eyJ");
  });

  it("serves /me from the session cookie and clears it on logout", async () => {
    getUserMock.mockResolvedValueOnce({ id: 1, email: "admin@local", passwordHash, role: "ADMIN" });
    const agent = request.agent(buildApp());
    await agent.post("/api/auth/login").send({ email: "admin@local", password: PASSWORD }).expect(200);
    await agent.get("/api/auth/me").expect(200, { id: 1, email: "admin@local", role: "ADMIN" });
    const logout = await agent.post("/api/auth/logout").expect(200);
    expect(logout.headers["set-cookie"]?.[0]).toContain("bp_session=;");
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
