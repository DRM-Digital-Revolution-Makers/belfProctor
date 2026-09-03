import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import http from "http";
import https from "https";
import path from "path";
import { URL } from "url";
import { prisma } from "../prisma";
import { resolveUploadDir } from "../runtimePaths";
import { withLock } from "../locks";

const UPLOAD_DIR = resolveUploadDir();
const UPDATES_ROOT = path.join(UPLOAD_DIR, "updates");
const UPDATE_INDEX_FILE = path.join(UPDATES_ROOT, "index.json");
const SERVER_UPDATES_ROOT = path.join(UPLOAD_DIR, "server_updates");
const SERVER_UPDATE_INDEX_FILE = path.join(SERVER_UPDATES_ROOT, "index.json");
const GITHUB_SYNC_STATE_FILE = path.join(UPLOAD_DIR, "github_release_sync.json");

const DEFAULT_CLIENT_ASSET_REGEX = "^BelfProctor(\\.|-|_).*\\.exe$|^BelfProctor\\.exe$";
const DEFAULT_SERVER_ASSET_REGEX = "^belfProctor-server\\.zip$|^BelfProctor(\\.|-|_)Server.*\\.zip$";
const MAX_RELEASE_ASSET_BYTES = parseInt(
  process.env.GITHUB_RELEASE_MAX_ASSET_BYTES || String(750 * 1024 * 1024),
  10,
);

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url?: string;
  url?: string;
  size?: number;
}

export interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export interface ReleaseSyncResult {
  ok: boolean;
  version: string;
  source: {
    tag: string;
    url?: string;
  };
  clientUpdate?: {
    version: string;
    filename: string;
    sha256: string;
    size: number;
    uploadedAt: string;
    alreadyStaged?: boolean;
  };
  serverUpdate?: {
    version: string;
    filename: string;
    sha256: string;
    size: number;
    stagedAt: string;
    path: string;
    alreadyStaged?: boolean;
  };
  skipped?: string;
}

interface UpdateMeta {
  version: string;
  filename: string;
  sha256: string;
  size: number;
  uploadedAt: string;
  notes?: string;
  source?: string;
}

interface ServerUpdateMeta {
  version: string;
  filename: string;
  sha256: string;
  size: number;
  stagedAt: string;
  path: string;
  notes?: string;
  source?: string;
}

function envFlag(name: string, fallback = false): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getToken(): string {
  return String(process.env.GITHUB_RELEASE_TOKEN || process.env.GITHUB_TOKEN || "").trim();
}

function getRepo(): { owner: string; repo: string } | null {
  const raw = String(
    process.env.GITHUB_RELEASE_REPOSITORY ||
      process.env.GITHUB_REPOSITORY ||
      "",
  ).trim();
  const match = raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function getRegex(envName: string, fallback: string): RegExp {
  const raw = String(process.env[envName] || fallback).trim();
  return new RegExp(raw, "i");
}

function extractVersion(release: GitHubReleasePayload): string {
  const source = String(release.tag_name || release.name || "").trim();
  const custom = String(process.env.GITHUB_RELEASE_VERSION_REGEX || "").trim();
  const regex = custom ? new RegExp(custom) : /(\d+\.\d+\.\d+(?:\.\d+)?)/;
  const match = source.match(regex);
  return match?.[1] || source.replace(/^v/i, "");
}

function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(\.\d+)?$/.test(version);
}

async function ensureDir(dir: string): Promise<void> {
  await fsPromises.mkdir(dir, { recursive: true });
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp_${process.pid}_${Date.now()}`;
  await fsPromises.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fsPromises.rename(tmp, filePath);
}

function verifySha256Signature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
    "utf-8",
  );
  const actual = Buffer.from(signature, "utf-8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function verifyGitHubWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = String(process.env.GITHUB_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  return verifySha256Signature(rawBody, signature, secret);
}

function requestBuffer(url: string, headers: Record<string, string>, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too many redirects"));
      return;
    }

    const parsed = new URL(url);
    const mod = parsed.protocol === "http:" ? http : https;
    const req = mod.get(parsed, { headers }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        resolve(requestBuffer(new URL(location, parsed).toString(), headers, redirects + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

async function downloadFile(
  url: string,
  destination: string,
  headers: Record<string, string>,
): Promise<{ sha256: string; size: number }> {
  await ensureDir(path.dirname(destination));
  const tmp = `${destination}.tmp_${process.pid}_${Date.now()}`;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "http:" ? http : https;
    const req = mod.get(parsed, { headers }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        downloadFile(new URL(location, parsed).toString(), destination, headers)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }

      const hash = crypto.createHash("sha256");
      let size = 0;
      const out = fs.createWriteStream(tmp);
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RELEASE_ASSET_BYTES) {
          req.destroy(new Error("release asset exceeds size limit"));
          return;
        }
        hash.update(chunk);
      });
      res.pipe(out);
      out.on("finish", async () => {
        out.close();
        try {
          await fsPromises.rename(tmp, destination);
          resolve({ sha256: hash.digest("hex"), size });
        } catch (e) {
          reject(e);
        }
      });
      out.on("error", reject);
    });
    req.on("error", async (e) => {
      try {
        await fsPromises.unlink(tmp);
      } catch {}
      reject(e);
    });
  });
}

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    "User-Agent": "BelfProctor-Release-Sync",
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchLatestGitHubRelease(): Promise<GitHubReleasePayload> {
  const repo = getRepo();
  if (!repo) {
    throw new Error("GITHUB_RELEASE_REPOSITORY must be owner/repo");
  }
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
  const raw = await requestBuffer(url, githubHeaders());
  return JSON.parse(raw.toString("utf-8"));
}

async function stageClientUpdate(
  release: GitHubReleasePayload,
  asset: GitHubReleaseAsset,
  version: string,
): Promise<ReleaseSyncResult["clientUpdate"]> {
  const versionDir = path.join(UPDATES_ROOT, version);
  const finalPath = path.join(versionDir, "BelfProctor.exe");
  const downloadUrl = asset.browser_download_url || asset.url;
  if (!downloadUrl) throw new Error(`client asset ${asset.name} has no download URL`);

  const existingIndex = await readJsonArray<UpdateMeta>(UPDATE_INDEX_FILE);
  const existing = existingIndex.find((item) => item.version === version);
  if (existing && fs.existsSync(finalPath)) {
    return {
      version,
      filename: existing.filename,
      sha256: existing.sha256,
      size: existing.size,
      uploadedAt: existing.uploadedAt,
      alreadyStaged: true,
    };
  }

  await ensureDir(versionDir);
  const { sha256, size } = await downloadFile(
    downloadUrl,
    finalPath,
    githubHeaders("application/octet-stream"),
  );

  const meta: UpdateMeta = {
    version,
    filename: "BelfProctor.exe",
    sha256,
    size,
    uploadedAt: new Date().toISOString(),
    notes: release.body || undefined,
    source: release.html_url || release.tag_name,
  };
  await writeJsonAtomic(path.join(versionDir, "meta.json"), meta);

  const index = await readJsonArray<UpdateMeta>(UPDATE_INDEX_FILE);
  const next = index.filter((item) => item.version !== version);
  next.push(meta);
  next.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  await writeJsonAtomic(UPDATE_INDEX_FILE, next);

  await prisma.agentVersion
    .upsert({
      where: { version },
      update: {
        filename: meta.filename,
        sha256,
        size: BigInt(size),
        notes: meta.notes,
      },
      create: {
        version,
        filename: meta.filename,
        sha256,
        size: BigInt(size),
        notes: meta.notes,
      },
    })
    .catch(() => null);

  return {
    version,
    filename: meta.filename,
    sha256,
    size,
    uploadedAt: meta.uploadedAt,
  };
}

async function stageServerUpdate(
  release: GitHubReleasePayload,
  asset: GitHubReleaseAsset,
  version: string,
): Promise<ReleaseSyncResult["serverUpdate"]> {
  const versionDir = path.join(SERVER_UPDATES_ROOT, version);
  const safeName = path.basename(asset.name || "server.zip").replace(/[^\w.\-]/g, "_");
  const finalPath = path.join(versionDir, safeName);
  const downloadUrl = asset.browser_download_url || asset.url;
  if (!downloadUrl) throw new Error(`server asset ${asset.name} has no download URL`);

  const existingIndex = await readJsonArray<ServerUpdateMeta>(SERVER_UPDATE_INDEX_FILE);
  const existing = existingIndex.find((item) => item.version === version);
  if (existing && fs.existsSync(existing.path)) {
    return {
      version,
      filename: existing.filename,
      sha256: existing.sha256,
      size: existing.size,
      stagedAt: existing.stagedAt,
      path: existing.path,
      alreadyStaged: true,
    };
  }

  await ensureDir(versionDir);
  const { sha256, size } = await downloadFile(
    downloadUrl,
    finalPath,
    githubHeaders("application/octet-stream"),
  );

  const meta: ServerUpdateMeta = {
    version,
    filename: safeName,
    sha256,
    size,
    stagedAt: new Date().toISOString(),
    path: finalPath,
    notes: release.body || undefined,
    source: release.html_url || release.tag_name,
  };
  await writeJsonAtomic(path.join(versionDir, "meta.json"), meta);

  const index = await readJsonArray<ServerUpdateMeta>(SERVER_UPDATE_INDEX_FILE);
  const next = index.filter((item) => item.version !== version);
  next.push(meta);
  next.sort((a, b) => b.stagedAt.localeCompare(a.stagedAt));
  await writeJsonAtomic(SERVER_UPDATE_INDEX_FILE, next);

  return {
    version,
    filename: meta.filename,
    sha256,
    size,
    stagedAt: meta.stagedAt,
    path: finalPath,
  };
}

async function writeSyncState(result: ReleaseSyncResult): Promise<void> {
  await writeJsonAtomic(GITHUB_SYNC_STATE_FILE, {
    ...result,
    syncedAt: new Date().toISOString(),
  });
}

export async function readGitHubSyncState(): Promise<any> {
  if (!fs.existsSync(GITHUB_SYNC_STATE_FILE)) return null;
  try {
    return JSON.parse(await fsPromises.readFile(GITHUB_SYNC_STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function syncGitHubRelease(
  release: GitHubReleasePayload,
): Promise<ReleaseSyncResult> {
  return await new Promise<ReleaseSyncResult>((resolve, reject) => {
    withLock("github-release-sync", async () => {
      try {
        if (release.draft) {
          const result: ReleaseSyncResult = {
            ok: true,
            version: "",
            source: { tag: String(release.tag_name || "") },
            skipped: "draft_release",
          };
          await writeSyncState(result);
          resolve(result);
          return;
        }
        if (release.prerelease && !envFlag("GITHUB_RELEASE_ALLOW_PRERELEASE")) {
          const result: ReleaseSyncResult = {
            ok: true,
            version: "",
            source: { tag: String(release.tag_name || "") },
            skipped: "prerelease_disabled",
          };
          await writeSyncState(result);
          resolve(result);
          return;
        }

        const version = extractVersion(release);
        if (!isValidVersion(version)) {
          throw new Error(`release version must be x.y.z: ${release.tag_name || release.name}`);
        }

        const assets = Array.isArray(release.assets) ? release.assets : [];
        const clientRegex = getRegex("GITHUB_CLIENT_ASSET_REGEX", DEFAULT_CLIENT_ASSET_REGEX);
        const serverRegex = getRegex("GITHUB_SERVER_ASSET_REGEX", DEFAULT_SERVER_ASSET_REGEX);
        const clientAsset = assets.find((asset) => clientRegex.test(asset.name));
        const serverAsset = assets.find((asset) => serverRegex.test(asset.name));

        const result: ReleaseSyncResult = {
          ok: true,
          version,
          source: {
            tag: String(release.tag_name || ""),
            url: release.html_url,
          },
        };

        if (clientAsset) {
          result.clientUpdate = await stageClientUpdate(release, clientAsset, version);
        }
        if (serverAsset) {
          result.serverUpdate = await stageServerUpdate(release, serverAsset, version);
        }
        if (!clientAsset && !serverAsset) {
          result.skipped = "no_matching_assets";
        }

        await writeSyncState(result);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }).catch(reject);
  });
}
