import { Router } from "express";
import { encryptAes256CbcPrefixedIv } from "../encryption";
import { requireAuth } from "../middleware/auth";
import { getClient, getPolicies } from "../store";
import { getPrimaryEncryptionKey } from "../keyring";

const router = Router();

// Admin list
router.get("/", requireAuth, async (_req, res) => {
  return res.json(await getPolicies());
});

// Client download (encrypted)
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  const clientId = (req.headers["x-client-id"] as string) || "";
  if (!clientId)
    return res.status(400).json({ message: "X-Client-Id header required" });

  let encryptionKey = "";
  let policy = null;

  const client = await getClient(clientId);
  // Use client key if available, otherwise fallback to global key (common in NO_DB setups)
  if (client && client.encryptionKey) {
    encryptionKey = client.encryptionKey;
  } else {
    encryptionKey = getPrimaryEncryptionKey();
  }

  const policies = await getPolicies();
  policy = policies.find((p: any) => p.id === id);

  if (!encryptionKey) {
    return res
      .status(400)
      .json({ message: "Client not registered or missing key" });
  }

  if (!policy) return res.status(404).json({ message: "Policy not found" });

  const payload = Buffer.from(JSON.stringify(policy), "utf-8");
  const encrypted = encryptAes256CbcPrefixedIv(payload, encryptionKey);
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(encrypted);
});

export default router;
