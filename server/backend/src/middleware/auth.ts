import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";

const JWT_SECRET = config.jwtSecret;

export interface AuthRequest extends Request {
  user?: { id: number; role: string; email: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  let token = "";
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    token = auth.slice("Bearer ".length);
  } else if (typeof req.query.token === "string" && req.query.token) {
    token = String(req.query.token);
  } else {
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
