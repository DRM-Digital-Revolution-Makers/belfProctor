import request from "supertest";
import jwt from "jsonwebtoken";
import express from "express";
import { config } from "../config";
import commandsRouter from "../routes/commands";

const app = express();
app.use(express.json());
app.use("/api/commands", commandsRouter);

function auth(role: "VIEWER" | "ADMIN"): string {
  return `Bearer ${jwt.sign({ id: 1, email: `${role.toLowerCase()}@test`, role }, config.jwtSecret)}`;
}

describe("agent command creation RBAC", () => {
  it.each([
    "/api/commands/send",
    "/api/commands/list",
    "/api/commands/file",
    "/api/commands/folder",
  ])("rejects VIEWER at %s", async (endpoint) => {
    await request(app)
      .post(endpoint)
      .set("Authorization", auth("VIEWER"))
      .send({ clientId: "CLIENT01", type: "uninstall", payload: {} })
      .expect(403, { message: "Administrator role required" });
  });

  it.each([
    ["/api/commands/send", { clientId: "CLIENT01", type: "ping" }],
    ["/api/commands/list", { clientId: "CLIENT01" }],
    ["/api/commands/file", { clientId: "CLIENT01", path: "x" }],
    ["/api/commands/folder", { clientId: "CLIENT01", path: "x" }],
  ])("allows ADMIN through RBAC at %s", async (endpoint, body) => {
    await request(app)
      .post(endpoint)
      .set("Authorization", auth("ADMIN"))
      .send(body)
      .expect(404, { message: "client not connected" });
  });
});
