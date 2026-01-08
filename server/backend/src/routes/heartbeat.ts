import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import {
  appendHeartbeat,
  getClient,
  saveClient,
  getLatestHeartbeats,
} from "../store";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const clientId = (req.headers["x-client-id"] as string) || "";
    if (!clientId)
      return res.status(400).json({ message: "X-Client-Id header required" });

    let encryptionKey = "";
    const client = getClient(clientId);

    // Strategy: Try client-specific key first, then global key
    let keysToTry: string[] = [];

    if (client && client.encryptionKey) {
      keysToTry.push(client.encryptionKey);
    }

    const globalKey =
      process.env.ENCRYPTION_KEY ||
      "0000000000000000000000000000000000000000000000000000000000000000";
    if (!keysToTry.includes(globalKey)) {
      keysToTry.push(globalKey);
    }

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);

    let decryptedJson = "";
    let usedKey = "";

    for (const key of keysToTry) {
      try {
        decryptedJson = decryptAes256CbcPrefixedIv(encrypted, key).toString(
          "utf-8"
        );
        // Validate JSON to ensure it wasn't just random garbage that happened to decrypt without error
        JSON.parse(decryptedJson);
        usedKey = key;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!usedKey) {
      console.error(
        `[Heartbeat] Failed to decrypt heartbeat for client ${clientId}. Tried ${keysToTry.length} keys.`
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(decryptedJson);
    console.log(`[Heartbeat] Successfully decrypted for ${clientId}. Payload size: ${decryptedJson.length}`);

    // Auto-register or Update
    if (!client) {
      saveClient({
        id: clientId,
        encryptionKey: usedKey,
        hostname: payload.Machine || payload.machine || "",
        os: payload.OS || payload.os || "",
        version: payload.Version || payload.version || "",
        lastSeen: new Date(),
        createdAt: new Date(),
      });
      console.log(`Auto-registered new client: ${clientId}`);
    } else {
      // Update last seen AND encryption key if it changed (e.g. we recovered using global key)
      const updateData: any = {
        id: clientId,
        lastSeen: new Date(),
        hostname: payload.Machine || payload.machine || client.hostname,
        os: payload.OS || payload.os || client.os,
        version: payload.Version || payload.version || client.version,
      };

      // If we used a key different from what was stored, update it!
      if (client.encryptionKey !== usedKey) {
        console.log(
          `Updating encryption key for client ${clientId} (Recovered via fallback)`
        );
        updateData.encryptionKey = usedKey;
      }

      saveClient(updateData);
    }

    appendHeartbeat({
      clientId,
      timestamp: new Date(),
      status: payload.Status || payload.status || "Online",
      version: payload.Version || payload.version || "",
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest heartbeat" });
  }
});

router.get("/", async (req, res) => {
  const data = getLatestHeartbeats();
  return res.json({ data, total: data.length });
});

router.get("/latest", async (_req, res) => {
  const data = getLatestHeartbeats();
  return res.json({ data });
});

export default router;
