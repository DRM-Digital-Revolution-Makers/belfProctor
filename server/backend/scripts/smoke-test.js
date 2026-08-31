const crypto = require("crypto");
const WebSocket = require("ws");

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.SMOKE_ADMIN_EMAIL;
const password = process.env.SMOKE_ADMIN_PASSWORD;
const encryptionKey = process.env.SMOKE_ENCRYPTION_KEY;
const clientId = `SMOKE_${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

function encryptBytes(plaintext, secret) {
  const key = crypto.pbkdf2Sync(secret, "BelfProctorSalt", 10_000, 32, "sha256");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([iv, cipher.update(plaintext), cipher.final()]);
}

function encryptPayload(value, secret) {
  return encryptBytes(Buffer.from(JSON.stringify(value), "utf8"), secret);
}

function wsSignature(id, timestamp, secret) {
  return crypto.createHmac("sha256", secret).update(`${id}\n${timestamp}`).digest("hex");
}

function waitForRejectedSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("unsigned WebSocket was not rejected")), 5_000);
    socket.once("close", (code) => {
      clearTimeout(timer);
      try {
        assert(code === 1008, `unsigned WebSocket closed with ${code}, expected 1008`);
        resolve();
      } catch (error) { reject(error); }
    });
    socket.once("error", () => undefined);
  });
}

function connectSignedSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("signed WebSocket did not open")), 5_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function nextJsonMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("command was not delivered over WebSocket")), 5_000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString("utf8"))); } catch (error) { reject(error); }
    });
  });
}

async function waitForServerConnection() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const health = await jsonRequest("/api/health");
    if (health.response.ok && Number(health.body?.connectedClients) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("signed WebSocket opened but was not registered by the server");
}

async function main() {
  assert(email && password && encryptionKey, "SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD and SMOKE_ENCRYPTION_KEY are required");

  const health = await jsonRequest("/api/health");
  assert(health.response.ok && health.body?.checks?.database?.ok, "health/database check failed");

  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert(login.response.ok && login.body?.token, `login failed (${login.response.status})`);
  const authHeaders = {
    authorization: `Bearer ${login.body.token}`,
    "content-type": "application/json",
  };

  const unauthorized = await jsonRequest("/api/heartbeat/latest");
  assert(unauthorized.response.status === 401, "monitoring endpoint is readable without JWT");

  const registration = await jsonRequest("/api/clients/register", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ id: clientId, encryptionKey }),
  });
  assert(registration.response.ok && registration.body?.id === clientId, "client registration failed");

  const heartbeatPayload = {
    Machine: "smoke-host",
    OS: "smoke-os",
    Version: "0.0.0-smoke",
    Status: "Online",
  };
  const heartbeat = await fetch(`${baseUrl}/api/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-client-id": clientId },
    body: encryptPayload(heartbeatPayload, encryptionKey),
  });
  assert(heartbeat.ok, `encrypted heartbeat failed (${heartbeat.status})`);

  const invalidHeartbeat = await fetch(`${baseUrl}/api/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-client-id": clientId },
    body: encryptPayload(heartbeatPayload, `${encryptionKey}-wrong`),
  });
  assert(invalidHeartbeat.status === 400, "heartbeat encrypted with the wrong key was accepted");

  const latest = await jsonRequest("/api/heartbeat/latest", { headers: authHeaders });
  assert(latest.response.ok, "authenticated heartbeat read failed");
  assert(latest.body?.data?.some((row) => row.clientId === clientId), "ingested heartbeat was not persisted");

  const screenshotPlaintext = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const screenshotForm = new FormData();
  screenshotForm.append("clientId", clientId);
  screenshotForm.append("timestamp", new Date().toISOString());
  screenshotForm.append(
    "screenshot",
    new Blob([encryptBytes(screenshotPlaintext, encryptionKey)]),
    "smoke.enc",
  );
  const screenshotUpload = await fetch(`${baseUrl}/api/screenshots`, {
    method: "POST",
    headers: { "x-client-id": clientId },
    body: screenshotForm,
  });
  assert(screenshotUpload.ok, `encrypted screenshot upload failed (${screenshotUpload.status})`);
  const screenshotRecord = await screenshotUpload.json();

  const screenshots = await jsonRequest(
    `/api/screenshots?clientId=${encodeURIComponent(clientId)}`,
    { headers: authHeaders },
  );
  assert(
    screenshots.response.ok && screenshots.body?.data?.some((row) => row.filename === screenshotRecord.filename),
    "uploaded screenshot was not indexed",
  );

  const screenshotDownload = await fetch(
    `${baseUrl}/api/screenshots/${encodeURIComponent(screenshotRecord.filename)}/file`,
    { headers: { authorization: authHeaders.authorization } },
  );
  assert(screenshotDownload.ok, "uploaded screenshot cannot be downloaded");
  assert(
    Buffer.from(await screenshotDownload.arrayBuffer()).equals(screenshotPlaintext),
    "downloaded screenshot differs from uploaded plaintext",
  );

  const wsBase = baseUrl.replace(/^http/, "ws");
  await waitForRejectedSocket(`${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = wsSignature(clientId, timestamp, encryptionKey);
  const socket = await connectSignedSocket(
    `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}&ts=${timestamp}&sig=${signature}`,
  );
  try {
    await waitForServerConnection();
    const commandMessage = nextJsonMessage(socket);
    const commandRequest = await jsonRequest("/api/commands/send", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ clientId, type: "smoke.echo", payload: { value: 42 } }),
    });
    assert(commandRequest.response.ok && commandRequest.body?.id, "admin command request failed");
    const deliveredCommand = await commandMessage;
    assert(deliveredCommand.id === commandRequest.body.id, "delivered command ID differs from API response");
    assert(deliveredCommand.type === "smoke.echo" && deliveredCommand.payload?.value === 42, "delivered command payload differs");
  } finally {
    socket.close();
  }

  console.log(JSON.stringify({ ok: true, clientId, checks: 13 }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
