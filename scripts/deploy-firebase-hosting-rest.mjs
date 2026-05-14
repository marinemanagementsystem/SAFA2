#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const projectId = process.env.PROJECT_ID || "safa-8f76e";
const siteId = process.env.FIREBASE_SITE || projectId;
const publicDir = resolve(process.env.FIREBASE_PUBLIC_DIR || "apps/web/out");
const runServiceId = process.env.CLOUD_RUN_SERVICE || "safa-api";
const runRegion = process.env.CLOUD_RUN_REGION || "europe-west1";
const message = process.env.FIREBASE_RELEASE_MESSAGE || "Deploy SAFA static web and /api Cloud Run rewrite";
const apiBase = "https://firebasehosting.googleapis.com/v1beta1";

function accessToken() {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

let token = accessToken();

async function api(path, options = {}) {
  let response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": projectId,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    token = accessToken();
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": projectId,
        ...(options.headers || {}),
      },
    });
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(absolutePath, base);
    }
    if (!entry.isFile()) {
      return [];
    }
    return relative(base, absolutePath).split("\\").join("/");
  });
}

function gzipFile(filePath) {
  return gzipSync(readFileSync(resolve(publicDir, filePath)), { level: 9 });
}

function hashGzip(gzipped) {
  return createHash("sha256").update(gzipped).digest("hex");
}

async function uploadHash(uploadUrl, hash, gzipped) {
  const uploadResponse = await fetch(`${uploadUrl}/${hash}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": projectId,
    },
    body: gzipped,
  });
  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`Upload failed for ${hash}: ${uploadResponse.status} ${text}`);
  }
}

function versionConfig() {
  return {
    cleanUrls: true,
    trailingSlashBehavior: "REMOVE",
    headers: [
      {
        glob: "**",
        headers: {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      },
    ],
    rewrites: [
      {
        glob: "/api/**",
        run: {
          serviceId: runServiceId,
          region: runRegion,
        },
      },
    ],
  };
}

async function main() {
  if (!statSync(publicDir).isDirectory()) {
    throw new Error(`Firebase public directory does not exist: ${publicDir}`);
  }

  const files = listFiles(publicDir);
  const gzippedByHash = new Map();
  const fileHashes = {};
  for (const file of files) {
    const gzipped = gzipFile(file);
    const hash = hashGzip(gzipped);
    fileHashes[`/${file}`] = hash;
    gzippedByHash.set(hash, gzipped);
  }

  const created = await api(`/projects/-/sites/${siteId}/versions`, {
    method: "POST",
    body: JSON.stringify({
      status: "CREATED",
      labels: {
        "deployment-tool": "codex-rest",
      },
    }),
  });
  const versionName = created.name;
  const versionId = versionName.split("/").pop();

  const entries = Object.entries(fileHashes);
  const uploadRequiredHashes = new Set();
  let uploadUrl = "";
  for (let index = 0; index < entries.length; index += 1000) {
    const batch = Object.fromEntries(entries.slice(index, index + 1000));
    const populated = await api(`/${versionName}:populateFiles`, {
      method: "POST",
      body: JSON.stringify({ files: batch }),
    });
    uploadUrl = populated.uploadUrl || uploadUrl;
    for (const hash of populated.uploadRequiredHashes || []) {
      uploadRequiredHashes.add(hash);
    }
  }

  if (uploadRequiredHashes.size && !uploadUrl) {
    throw new Error("Firebase Hosting requested uploads but did not return an uploadUrl.");
  }

  let uploaded = 0;
  for (const hash of uploadRequiredHashes) {
    await uploadHash(uploadUrl, hash, gzippedByHash.get(hash));
    uploaded += 1;
  }

  await api(`/projects/-/sites/${siteId}/versions/${versionId}?updateMask=status,config`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "FINALIZED",
      config: versionConfig(),
    }),
  });

  await api(`/projects/-/sites/${siteId}/channels/live/releases?versionName=${encodeURIComponent(versionName)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });

  console.log(
    JSON.stringify(
      {
        projectId,
        siteId,
        publicDir,
        versionName,
        files: files.length,
        uploaded,
        url: `https://${siteId}.web.app`,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
