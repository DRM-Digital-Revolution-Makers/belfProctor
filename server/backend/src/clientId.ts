import type { Request } from "express";

export function normalizeClientId(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(0, 80);
}

export function getSenderClientId(req: Request): string {
  const fromHeader = req.headers["x-client-id"];
  const fromBody = (req as any).body?.clientId;
  const fromQuery = (req as any).query?.clientId;
  const candidate = normalizeClientId(String(fromHeader || fromBody || fromQuery || ""));
  if (candidate) return candidate;

  const ip = normalizeClientId(String(req.ip || (req.socket as any)?.remoteAddress || "unknown"));
  return `ip_${ip || "unknown"}`;
}

