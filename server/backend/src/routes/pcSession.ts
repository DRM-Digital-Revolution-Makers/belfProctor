import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { getClient, saveClient } from "../store";
import { getSenderClientId } from "../clientId";
import { getKeysToTry } from "../keyring";
import { prisma } from "../prisma";
import { approximateBootAt } from "../services/pcSessionHelpers";
import { startOfTashkentDay, endOfTashkentDay } from "../tz";
import { requireAuth } from "../middleware/auth";
import { now as authoritativeNow, reconcile as reconcileTime } from "../serverTime";

const router = Router();

function parseTimestamp(raw: unknown, fallback: Date): Date {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  // Client always sends UTC ISO with 'Z'; tolerate the legacy unsuffixed form too.
  const normalized = /[zZ]$/.test(value) || /[+\-]\d{2}:\d{2}$/.test(value)
    ? value
    : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

router.post("/", async (req, res) => {
  try {
    const clientId = getSenderClientId(req);
    const client = await getClient(clientId);
    const keysToTry = getKeysToTry(client?.encryptionKey);

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);
    if (encrypted.length < 17) {
      return res.status(400).json({ message: "Empty payload" });
    }

    let json = "";
    let usedKey = "";
    for (const key of keysToTry) {
      try {
        json = decryptAes256CbcPrefixedIv(encrypted, key).toString("utf-8");
        JSON.parse(json);
        usedKey = key;
        break;
      } catch {
        continue;
      }
    }

    const now = authoritativeNow();
    if (!usedKey) {
      return res.status(400).json({ message: "Decryption failed" });
    }

    if (!client) {
      await saveClient({
        id: clientId,
        encryptionKey: usedKey,
        createdAt: now,
        lastSeen: now,
      });
    } else if (client.encryptionKey !== usedKey) {
      await saveClient({ id: clientId, encryptionKey: usedKey, lastSeen: now });
    } else {
      await saveClient({ id: clientId, lastSeen: now });
    }

    const payload = JSON.parse(json);
    const kind = String(payload.Kind || payload.kind || "").toLowerCase();
    const bootId = String(payload.BootId || payload.bootId || "").trim();
    // Reconcile against authoritative time so a client with broken Windows TZ
    // can't backdate/forwarddate its Boot/Shutdown.
    const ts = reconcileTime(parseTimestamp(payload.TimestampUtc || payload.timestampUtc, now));

    if (!bootId) {
      return res.status(400).json({ message: "bootId required" });
    }

    if (kind === "boot") {
      // Idempotent on bootId: same agent restart for same boot doesn't duplicate.
      await prisma.pcSession.upsert({
        where: { bootId },
        update: {},
        create: {
          clientId,
          bootAt: ts,
          source: "explicit",
          bootId,
        },
      });
      return res.json({ ok: true });
    }

    if (kind === "shutdown") {
      const existing = await prisma.pcSession.findUnique({ where: { bootId } });
      if (existing) {
        if (!existing.shutdownAt) {
          await prisma.pcSession.update({
            where: { bootId },
            data: { shutdownAt: ts },
          });
        }
        return res.json({ ok: true });
      }
      // Shutdown arrived without a matching Boot — record it, but approximate
      // bootAt from heartbeat history instead of using shutdownAt (which would
      // create a misleading zero-duration session) [B-M2].
      await prisma.pcSession.create({
        data: {
          clientId,
          bootAt: await approximateBootAt(clientId, ts),
          shutdownAt: ts,
          source: "explicit",
          bootId,
        },
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ message: "Unknown kind" });
  } catch (e) {
    console.error("[pc-session] ingest failed", e);
    res.status(500).json({ message: "Failed to ingest pc-session" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const clientId = String(req.query.clientId || "").trim();
    const dateStr = String(req.query.date || "").trim();
    if (!clientId) {
      return res.status(400).json({ message: "clientId required" });
    }

    const ref = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
    const from = startOfTashkentDay(ref);
    const to = endOfTashkentDay(ref);

    const sessions = await prisma.pcSession.findMany({
      where: {
        clientId,
        OR: [
          { bootAt: { gte: from, lte: to } },
          { shutdownAt: { gte: from, lte: to } },
        ],
      },
      orderBy: { bootAt: "asc" },
    });

    return res.json({ data: sessions, total: sessions.length });
  } catch (e) {
    console.error("[pc-session] list failed", e);
    res.status(500).json({ message: "Failed to load pc-session" });
  }
});

export default router;
