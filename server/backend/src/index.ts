import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";

import authRouter from "./routes/auth";
import clientsRouter from "./routes/clients";
import eventsRouter from "./routes/events";
import heartbeatRouter from "./routes/heartbeat";
import filesRouter from "./routes/files";
import policiesRouter from "./routes/policies";
import activityRouter from "./routes/activity";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");

// Ensure upload directories
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, "screenshots"), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, "reports"), { recursive: true });

app.use(helmet());
const corsOptions: cors.CorsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiter for ingestion endpoints
const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use("/api/", limiter);

// Raw parser for octet-stream endpoints
app.use("/api/events", express.raw({ type: "application/octet-stream", limit: "20mb" }));
app.use("/api/heartbeat", express.raw({ type: "application/octet-stream", limit: "5mb" }));
app.use("/api/activity", express.raw({ type: "application/octet-stream", limit: "2mb" }));

// Routes
app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/heartbeat", heartbeatRouter);
app.use("/api", filesRouter); // screenshots & reports
app.use("/api/policies", policiesRouter);
app.use("/api/activity", activityRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Seed default admin if not exists
async function ensureAdmin() {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { email, passwordHash, role: "ADMIN" } });
    console.log(`Created default admin: ${email}`);
  }
}

ensureAdmin().catch(console.error);

app.listen(PORT, HOST as any, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});
