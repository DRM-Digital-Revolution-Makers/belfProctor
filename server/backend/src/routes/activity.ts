import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import { appendActivity, getClient, getLatestActivity } from "../store";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId)
      return res.status(400).json({ message: "X-Client-Id header required" });

    let encryptionKey = "";
    const client = getClient(clientId);
    if (client && client.encryptionKey) {
      encryptionKey = client.encryptionKey;
    } else {
      encryptionKey =
        process.env.ENCRYPTION_KEY ||
        "0000000000000000000000000000000000000000000000000000000000000000";
    }

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);
    const json = decryptAes256CbcPrefixedIv(encrypted, encryptionKey).toString(
      "utf-8"
    );
    const payload = JSON.parse(json);

    appendActivity({
      clientId,
      timestamp: new Date(payload.Timestamp || payload.timestamp || Date.now()),
      isActive: Boolean(payload.IsActive ?? payload.isActive ?? false),
      activeMilliseconds: parseInt(
        String(payload.ActiveMilliseconds ?? payload.activeMilliseconds ?? 0),
        10
      ),
      inactiveMilliseconds: parseInt(
        String(
          payload.InactiveMilliseconds ?? payload.inactiveMilliseconds ?? 0
        ),
        10
      ),
    });
    return res.json({ id: "file-saved" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest activity" });
  }
});

router.get("/", async (req, res) => {
  const data = getLatestActivity(100);
  return res.json({ data, total: data.length });
});

router.get("/latest", async (_req, res) => {
  const data = getLatestActivity(20);
  return res.json({ data });
});

export default router;
