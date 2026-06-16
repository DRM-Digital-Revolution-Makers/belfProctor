import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config } from "../config";

// The screenshot file route returns 400/404 before any DB access for the cases
// under test, so the store/prisma layers don't need real data here.
import filesRouter from "../routes/files";

function buildApp() {
  const app = express();
  app.use("/api", filesRouter);
  return app;
}

function authHeader(): string {
  const token = jwt.sign(
    { id: 1, role: "ADMIN", email: "admin@local" },
    config.jwtSecret,
    { expiresIn: "1h" },
  );
  return `Bearer ${token}`;
}

describe("GET /api/screenshots/:filename/file — path traversal guard [B-C3]", () => {
  it("GIVEN no auth WHEN requesting a file THEN 401", async () => {
    await request(buildApp())
      .get("/api/screenshots/whatever.jpg/file")
      .expect(401);
  });

  it.each([
    "..%2F..%2F..%2F..%2Fetc%2Fpasswd",
    "..%5C..%5Cwindows%5Csystem32%5Cconfig%5Csam",
    "..%2F..%2Fsecret.jpg",
  ])("GIVEN a traversal filename (%s) THEN 400", async (encoded) => {
    await request(buildApp())
      .get(`/api/screenshots/${encoded}/file`)
      .set("Authorization", authHeader())
      .expect(400);
  });

  it("GIVEN a non-image extension THEN 400", async () => {
    await request(buildApp())
      .get("/api/screenshots/payload.exe/file")
      .set("Authorization", authHeader())
      .expect(400);
  });

  it("GIVEN a well-formed but non-existent file THEN 404 (not a server error)", async () => {
    await request(buildApp())
      .get("/api/screenshots/CLIENT01_2026-06-15T10-30-00.000Z.jpg/file")
      .set("Authorization", authHeader())
      .expect(404);
  });
});
