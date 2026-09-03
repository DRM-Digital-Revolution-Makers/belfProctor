import express from "express";
import request from "supertest";
import activityRouter from "../routes/activity";
import eventsRouter from "../routes/events";
import heartbeatRouter from "../routes/heartbeat";

const app = express();
app.use("/api/activity", activityRouter);
app.use("/api/events", eventsRouter);
app.use("/api/heartbeat", heartbeatRouter);

describe("monitoring read endpoints", () => {
  test.each([
    "/api/activity",
    "/api/activity/latest",
    "/api/events",
    "/api/events/stats",
    "/api/heartbeat",
    "/api/heartbeat/latest",
  ])("GET %s rejects unauthenticated access", async (path) => {
    await request(app).get(path).expect(401);
  });
});
