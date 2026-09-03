import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getUser } from "../store";
import { config } from "../config";
import rateLimit from "express-rate-limit";

const router = Router();
const JWT_SECRET = config.jwtSecret;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    return `${req.ip || req.socket.remoteAddress || "unknown"}:${email}`;
  },
  message: { message: "Too many login attempts. Try again later." },
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });
  const user = await getUser(email);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });
  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "12h" },
  );
  res.cookie("bp_session", token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = String(req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("bp_session="))
    ?.slice("bp_session=".length);
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const user = jwt.verify(decodeURIComponent(token), JWT_SECRET) as any;
    return res.json({ id: user.id, email: user.email, role: user.role });
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("bp_session", { path: "/", sameSite: "strict", secure: config.isProduction });
  res.json({ ok: true });
});

export default router;
