import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";

const JWT_SECRET = config.jwtSecret;

export interface AuthRequest extends Request {
  user?: { id: number; role: string; email: string };
}

export function extractAuthToken(req: Request): string {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  const cookies = String(req.headers.cookie || "");
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "bp_session") return decodeURIComponent(rest.join("="));
  }
  // Never accept session JWTs in URLs: query strings leak through browser
  // history, reverse-proxy/access logs and Referer headers.
  return "";
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    req.user = { id: payload.id, role: payload.role, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "Administrator role required" });
    }
    next();
  });
}
