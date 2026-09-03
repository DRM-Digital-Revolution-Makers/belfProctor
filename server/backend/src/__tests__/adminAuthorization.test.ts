import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { requireAdmin } from "../middleware/auth";

const app = express();
app.post("/admin-only", requireAdmin, (_req, res) => res.json({ ok: true }));

const token = (role: string) => jwt.sign(
  { id: 1, email: `${role.toLowerCase()}@test`, role },
  config.jwtSecret,
);

describe("requireAdmin", () => {
  it("rejects anonymous and VIEWER mutation requests", async () => {
    await request(app).post("/admin-only").expect(401);
    await request(app).post("/admin-only")
      .set("Authorization", `Bearer ${token("VIEWER")}`)
      .expect(403, { message: "Administrator role required" });
  });

  it("allows an ADMIN mutation request", async () => {
    await request(app).post("/admin-only")
      .set("Authorization", `Bearer ${token("ADMIN")}`)
      .expect(200, { ok: true });
  });
});
