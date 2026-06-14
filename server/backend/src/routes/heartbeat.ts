import { Router } from "express";
import { decryptAes256CbcPrefixedIv } from "../encryption";
import {
  appendHeartbeat,
  getClient,
  saveClient,
  getLatestHeartbeats,
} from "../store";
import { getSenderClientId } from "../clientId";
import { consumePendingUninstall } from "../wsHub";
import { getKeysToTry } from "../keyring";
import { prisma } from "../prisma";
import { now as authoritativeNow } from "../serverTime";

const router = Router();

router.post("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const clientId = getSenderClientId(req);

    let encryptionKey = "";
    const client = await getClient(clientId);

    const keysToTry = getKeysToTry(client?.encryptionKey);

    const encrypted: Buffer = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from([]);

    let decryptedJson = "";
    let usedKey = "";

    for (const key of keysToTry) {
      try {
        decryptedJson = decryptAes256CbcPrefixedIv(encrypted, key).toString(
          "utf-8",
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
      const now = authoritativeNow();
      if (!client) {
        await saveClient({ id: clientId, createdAt: now, lastSeen: now });
      } else {
        await saveClient({ id: clientId, lastSeen: now });
      }
      console.error(
        `[Heartbeat] Failed to decrypt heartbeat for client ${clientId}. Tried ${keysToTry.length} keys.`,
      );
      return res.status(400).json({ message: "Decryption failed" });
    }

    const payload = JSON.parse(decryptedJson);
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Heartbeat] Successfully decrypted for ${clientId}. Payload size: ${decryptedJson.length}`,
      );
    }

    // Auto-register or Update
    const now = authoritativeNow();
    if (!client) {
      await saveClient({
        id: clientId,
        encryptionKey: usedKey,
        hostname: payload.Machine || payload.machine || "",
        os: payload.OS || payload.os || "",
        version: payload.Version || payload.version || "",
        lastSeen: now,
        lastHeartbeat: now, // Explicitly set lastHeartbeat
        createdAt: now,
      });
      if (process.env.NODE_ENV !== "production") {
        console.log(`Auto-registered new client: ${clientId}`);
      }
    } else {
      // Update last seen AND encryption key if it changed (e.g. we recovered using global key)
      const updateData: any = {
        id: clientId,
        lastSeen: now,
        lastHeartbeat: now, // Explicitly set lastHeartbeat
        hostname: payload.Machine || payload.machine || client.hostname,
        os: payload.OS || payload.os || client.os,
        version: payload.Version || payload.version || client.version,
      };

      // If we used a key different from what was stored, update it!
      if (client.encryptionKey !== usedKey) {
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `Updating encryption key for client ${clientId} (Recovered via fallback)`,
          );
        }
        updateData.encryptionKey = usedKey;
      }

      await saveClient(updateData);
    }

    await appendHeartbeat({
      clientId,
      timestamp: authoritativeNow(),
      status: payload.Status || payload.status || "Online",
      version: payload.Version || payload.version || "",
    });
    const heartbeatVersion = String(payload.Version || payload.version || "").trim();
    if (heartbeatVersion) {
      await prisma.updateDeployment
        .updateMany({
          where: {
            clientId,
            version: heartbeatVersion,
            status: { in: ["sent", "downloading", "verifying", "installing", "restarted"] },
          },
          data: { status: "confirmed", detail: "confirmed_by_heartbeat" },
        })
        .catch(() => null);
    }
    const ms = Date.now() - t0;
    if (ms > 100 && process.env.NODE_ENV === "production") {
      console.warn(`[Heartbeat] Slow request ${clientId}: ${ms}ms`);
    }
    const uninstall = await consumePendingUninstall(clientId);
    if (uninstall && uninstall.id) {
      return res.json({ ok: true, uninstall });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to ingest heartbeat" });
  }
});

router.get("/", async (req, res) => {
  const data = await getLatestHeartbeats();
  return res.json({ data, total: data.length });
});

router.get("/latest", async (_req, res) => {
  const data = await getLatestHeartbeats();
  return res.json({ data, serverTime: authoritativeNow() });
});

export default router;
