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
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(secret, salt, 210_000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from("BPG1", "ascii"), salt, nonce, cipher.getAuthTag(), ciphertext]);
}

function encryptPayload(value, secret) {
  return encryptBytes(Buffer.from(JSON.stringify(value), "utf8"), secret);
}

function wsSignature(id, timestamp, secret, nonce) {
  return crypto.createHmac("sha256", secret).update(`${id}\n${timestamp}\n${nonce}`).digest("hex");
}

function updateDownloadSignature(id, version, timestamp, secret, nonce) {
  return crypto.createHmac("sha256", secret)
    .update(`belfproctor-update-download-v1\n${id}\n${version}\n${timestamp}\n${nonce}`)
    .digest("hex");
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
  const setCookie = login.response.headers.get("set-cookie") || "";
  const sessionCookie = setCookie.split(";", 1)[0];
  assert(login.response.ok && login.body?.ok, `login failed (${login.response.status})`);
  assert(sessionCookie.startsWith("bp_session="), "login did not set the session cookie");
  assert(/;\s*HttpOnly/i.test(setCookie) && /;\s*SameSite=Strict/i.test(setCookie),
    "session cookie is missing HttpOnly or SameSite=Strict");
  if (baseUrl.startsWith("https://")) {
    assert(/;\s*Secure/i.test(setCookie), "HTTPS session cookie is missing Secure");
  }
  assert(!JSON.stringify(login.body).includes("eyJ"), "login exposed a JWT to JavaScript");
  const authHeaders = {
    cookie: sessionCookie,
    "content-type": "application/json",
  };

  const unauthorized = await jsonRequest("/api/heartbeat/latest");
  assert(unauthorized.response.status === 401, "monitoring endpoint is readable without a session");

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
    { headers: { cookie: sessionCookie } },
  );
  assert(screenshotDownload.ok, "uploaded screenshot cannot be downloaded");
  assert(
    Buffer.from(await screenshotDownload.arrayBuffer()).equals(screenshotPlaintext),
    "downloaded screenshot differs from uploaded plaintext",
  );

  const updateVersion = `0.0.0.${Date.now()}`;
  const updateFixture = Buffer.from("belfproctor-smoke-update-fixture", "utf8");
  let updateUploaded = false;
  try {
    const updateForm = new FormData();
    updateForm.append("version", updateVersion);
    updateForm.append("notes", "temporary smoke artifact");
    updateForm.append("file", new Blob([updateFixture]), "BelfProctor.exe");
    const updateUpload = await fetch(`${baseUrl}/api/updates`, {
      method: "POST",
      headers: { cookie: sessionCookie },
      body: updateForm,
    });
    assert(updateUpload.ok, `temporary update upload failed (${updateUpload.status})`);
    updateUploaded = true;

    const unsignedUpdate = await fetch(`${baseUrl}/api/updates/${updateVersion}/file`, {
      headers: { "x-client-id": clientId },
    });
    assert(unsignedUpdate.status === 401, "unsigned update download was accepted");

    const updateTimestamp = String(Math.floor(Date.now() / 1000));
    const updateNonce = crypto.randomBytes(16).toString("hex");
    const updateHeaders = {
      "x-client-id": clientId,
      "x-client-timestamp": updateTimestamp,
      "x-client-nonce": updateNonce,
      "x-client-signature": updateDownloadSignature(
        clientId,
        updateVersion,
        updateTimestamp,
        encryptionKey,
        updateNonce,
      ),
    };
    const signedUpdate = await fetch(`${baseUrl}/api/updates/${updateVersion}/file`, {
      headers: updateHeaders,
    });
    assert(signedUpdate.ok, `signed update download failed (${signedUpdate.status})`);
    assert(
      Buffer.from(await signedUpdate.arrayBuffer()).equals(updateFixture),
      "signed update download differs from uploaded fixture",
    );
    const replayedUpdate = await fetch(`${baseUrl}/api/updates/${updateVersion}/file`, {
      headers: updateHeaders,
    });
    assert(replayedUpdate.status === 401, "replayed update download signature was accepted");
  } finally {
    if (updateUploaded) {
      const cleanup = await fetch(`${baseUrl}/api/updates/${updateVersion}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      });
      assert(cleanup.ok, `temporary update cleanup failed (${cleanup.status})`);
    }
  }

  const wsBase = baseUrl.replace(/^http/, "ws");
  await waitForRejectedSocket(`${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = wsSignature(clientId, timestamp, encryptionKey, nonce);
  const signedSocketUrl = `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}&ts=${timestamp}&nonce=${nonce}&sig=${signature}`;
  const socket = await connectSignedSocket(signedSocketUrl);
  try {
    await waitForRejectedSocket(signedSocketUrl);
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

  console.log(JSON.stringify({ ok: true, clientId, checks: 18 }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
