import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const authCookieName = process.env.SAFA_AUTH_COOKIE_NAME || "__session";

const sessionMaxAgeSeconds = Number(process.env.SAFA_SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12);
const defaultLocalUsername = "sarper";
const defaultLocalCredentialHash = "a8e496a04c1ad79567fdbc1201aca061dbe1dfea796e49cf9979cd1433c982c2";
const localDevSessionSecret = "safa-local-dev-session-secret";

export interface AuthSession {
  username: string;
  source: "api";
  issuedAt: string;
  expiresAt: string;
}

export type CredentialVerificationResult =
  | { ok: true; username: string }
  | { ok: false; reason: "server_auth_not_configured" | "mismatch" };

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.K_SERVICE);
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUsername(username: string) {
  return username.trim().toLocaleLowerCase("tr-TR");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredSessionSecret() {
  const secret = process.env.SAFA_SESSION_SECRET || process.env.APP_SECRET_KEY;
  if (secret?.trim()) return secret.trim();
  return isProductionRuntime() ? null : localDevSessionSecret;
}

function configuredCredential() {
  const username = normalizeUsername(process.env.SAFA_ADMIN_USERNAME || defaultLocalUsername);
  const password = process.env.SAFA_ADMIN_PASSWORD;
  const passwordHash = process.env.SAFA_ADMIN_PASSWORD_HASH;

  if (passwordHash?.trim()) {
    return { username, credentialHash: passwordHash.trim() };
  }

  if (password) {
    return { username, credentialHash: sha256Hex(`${username}:${password}`) };
  }

  if (isProductionRuntime() || process.env.SAFA_REQUIRE_CONFIGURED_AUTH === "true") {
    return null;
  }

  return { username: defaultLocalUsername, credentialHash: defaultLocalCredentialHash };
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode<TValue>(value: string): TValue | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as TValue;
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseCookies(header: string | undefined) {
  if (!header) return new Map<string, string>();

  return new Map(
    header
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        if (separator === -1) return [entry, ""];
        return [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))];
      })
  );
}

function shouldUseSecureCookie(request: Request) {
  if (process.env.SAFA_COOKIE_SECURE === "true") return true;
  if (process.env.SAFA_COOKIE_SECURE === "false") return false;

  const forwardedProtocol = String(request.headers["x-forwarded-proto"] ?? "");
  return request.protocol === "https" || forwardedProtocol.split(",").map((item) => item.trim()).includes("https") || isProductionRuntime();
}

function serializeCookie(name: string, value: string, request: Request, maxAgeSeconds: number) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (shouldUseSecureCookie(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function verifyAdminCredential(username: string, password: string): CredentialVerificationResult {
  const credential = configuredCredential();
  if (!credential || !configuredSessionSecret()) {
    return { ok: false, reason: "server_auth_not_configured" };
  }

  const normalizedUsername = normalizeUsername(username);
  const actualHash = sha256Hex(`${normalizedUsername}:${password}`);

  if (normalizedUsername !== credential.username || !safeEqual(actualHash, credential.credentialHash)) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, username: normalizedUsername };
}

export function createSessionCookie(request: Request, username: string) {
  const secret = configuredSessionSecret();
  if (!secret) return null;

  const now = Date.now();
  const session: AuthSession = {
    username,
    source: "api",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionMaxAgeSeconds * 1000).toISOString()
  };
  const payload = encode(session);
  const token = `${payload}.${sign(payload, secret)}`;

  return {
    session,
    cookie: serializeCookie(authCookieName, token, request, sessionMaxAgeSeconds)
  };
}

export function createClearSessionCookie(request: Request) {
  return serializeCookie(authCookieName, "", request, 0);
}

export function readAuthSessionFromRequest(request: Request): AuthSession | null {
  const secret = configuredSessionSecret();
  if (!secret) return null;

  const token = parseCookies(request.headers.cookie).get(authCookieName);
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;

  const session = decode<AuthSession>(payload);
  if (!session?.username || !session.expiresAt || session.source !== "api") return null;
  if (Number.isNaN(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) return null;

  return session;
}
