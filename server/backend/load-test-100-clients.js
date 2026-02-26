const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SERVER_URL = process.env.LOAD_SERVER_URL || "http://localhost:8080/api";

const DEFAULT_GLOBAL_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

function detectPassword() {
  if (process.env.LOAD_ENCRYPTION_KEY) return process.env.LOAD_ENCRYPTION_KEY;
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  try {
    const base = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");
    const clientsDir = path.join(base, "clients");
    const files = fs.readdirSync(clientsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(clientsDir, f), "utf-8");
        const obj = JSON.parse(raw);
        if (obj && obj.encryptionKey) return obj.encryptionKey;
      } catch {}
    }
  } catch {}
  return DEFAULT_GLOBAL_KEY;
}

const PASSWORD = detectPassword();

const CLIENT_COUNT = parseInt(process.env.LOAD_CLIENTS || "100", 10);
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.LOAD_HEARTBEAT_INTERVAL_MS || "60000",
  10,
);
const ACTIVITY_INTERVAL_MS = parseInt(
  process.env.LOAD_ACTIVITY_INTERVAL_MS || "60000",
  10,
);

const SALT = "BelfProctorSalt";
const ITERATIONS = 10000;
const KEYLEN = 32;
const DIGEST = "sha256";

function deriveKeyFromPassword(password) {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(SALT, "utf-8"),
    ITERATIONS,
    KEYLEN,
    DIGEST,
  );
}

function encryptAes256CbcPrefixedIv(plain, password) {
  const key = deriveKeyFromPassword(password);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function postEncrypted(path, clientId, json) {
  return new Promise((resolve) => {
    try {
      const url = new URL(SERVER_URL + path);
      const body = Buffer.from(JSON.stringify(json), "utf-8");
      const encrypted = encryptAes256CbcPrefixedIv(body, PASSWORD);

      const isHttps = url.protocol === "https:";
      const transport = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": encrypted.length,
          "x-client-id": clientId,
        },
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      });

      req.on("error", () => resolve());
      req.on("timeout", () => {
        req.destroy();
        resolve();
      });

      req.write(encrypted);
      req.end();
    } catch {
      resolve();
    }
  });
}

function createClients(count) {
  const clients = [];
  for (let i = 0; i < count; i++) {
    clients.push({
      id: `LOAD-${String(i + 1).padStart(3, "0")}`,
      active: true,
      activeMs: 0,
      inactiveMs: 0,
      lastSwitch: Date.now(),
    });
  }
  return clients;
}

async function sendHeartbeat(client) {
  const payload = {
    Machine: client.id,
    OS: "Windows 8.1",
    Version: "load-test",
    Status: client.active ? "OnlineActive" : "OnlineIdle",
  };
  await postEncrypted("/heartbeat", client.id, payload);
}

async function sendActivity(client) {
  const now = Date.now();
  const sinceLast = now - client.lastSwitch;

  const delta = sinceLast > 0 ? sinceLast : 0;
  client.activeMs += delta;
  client.inactiveMs = 0;
  client.active = true;
  client.lastSwitch = now;

  const payload = {
    Timestamp: new Date().toISOString(),
    IsActive: true,
    ActiveMilliseconds: client.activeMs,
    InactiveMilliseconds: client.inactiveMs,
  };

  await postEncrypted("/activity", client.id, payload);
}

async function main() {
  console.log(
    `Starting load test: ${CLIENT_COUNT} clients -> ${SERVER_URL} (heartbeat=${HEARTBEAT_INTERVAL_MS}ms, activity=${ACTIVITY_INTERVAL_MS}ms)`,
  );
  const clients = createClients(CLIENT_COUNT);

  setInterval(() => {
    clients.forEach((c) => {
      sendHeartbeat(c);
    });
  }, HEARTBEAT_INTERVAL_MS);

  setInterval(() => {
    clients.forEach((c) => {
      sendActivity(c);
    });
  }, ACTIVITY_INTERVAL_MS);

  console.log("Press Ctrl+C to stop load test.");
}

main().catch((e) => {
  console.error(e);
});
