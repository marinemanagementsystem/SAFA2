import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { SettingsService } from "../settings/settings.service";
import type { GibPortalConnection } from "../settings/connection-types";
import type { GibPortalInvoiceDraftPayload } from "./portal-draft-payload";
import { normalizePortalEttn } from "./portal-draft-payload";
import {
  proxiedPortalUrl,
  rewritePortalHtml,
  rewritePortalText,
  type PortalProxyRewriteContext
} from "./portal-proxy-rewrite";

interface AssosLoginResponse {
  token?: string;
  redirectUrl?: string;
  error?: unknown;
  messages?: Array<{ text?: string }>;
}

interface AssosLogoutResponse {
  data?: unknown;
  error?: unknown;
  messages?: Array<{ text?: string }>;
}

interface DispatchResponse {
  data?: unknown;
  result?: unknown;
  rows?: unknown;
  error?: unknown;
  messages?: Array<{ text?: string }>;
}

interface PortalDraftUploadInput {
  localDraftId: string;
  payload: GibPortalInvoiceDraftPayload;
}

type PortalSessionSource = "fresh" | "cached";

interface CachedPortalLaunchSession {
  portalUrl: string;
  launchUrl: string;
  token?: string;
  tokenReceived: boolean;
  openedAt: string;
  expiresAt: string;
  source: "fresh";
  message: string;
  lastPortalMessage?: string;
}

interface CachedPortalProxySession {
  sessionId: string;
  portalUrl: string;
  portalOrigin: string;
  launchUrl: string;
  token?: string;
  cookieJar: Record<string, string>;
  openedAt: string;
  expiresAt: string;
  lastTargetUrl?: string;
}

interface CachedPortalProxyIndex {
  sessionId: string;
  portalUrl: string;
  expiresAt: string;
}

export interface PortalLaunchSession {
  portalUrl: string;
  launchUrl: string;
  tokenReceived: boolean;
  openedAt: string;
  expiresAt: string;
  source: PortalSessionSource;
  message: string;
  lastPortalMessage?: string;
}

export interface PortalDraftUploadResult {
  localDraftId: string;
  ok: boolean;
  uuid?: string;
  attemptedUuid?: string;
  documentNumber?: string;
  status?: string;
  message?: string;
  command: string;
  pageName: string;
  response?: DispatchResponse;
  error?: string;
}

export interface PortalLogoutResult {
  portalUrl: string;
  attempted: boolean;
  ok: boolean;
  source: "cached-token" | "none";
  message: string;
  portalMessage?: string;
}

export interface PortalProxySessionResult {
  proxyUrl: string;
  expiresAt: string;
  message: string;
}

const GIB_PORTAL_LAUNCH_SESSION_KEY = "session.gibPortal.launch";
const GIB_PORTAL_PROXY_SESSION_PREFIX = "session.gibPortal.proxy";
const GIB_PORTAL_PROXY_LATEST_SESSION_KEY = "session.gibPortal.proxy.latest";
const DEFAULT_PORTAL_SESSION_TTL_SECONDS = 10 * 60;
const DEFAULT_PORTAL_PROXY_SESSION_TTL_SECONDS = 30 * 60;

class GibConcurrentSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GibConcurrentSessionError";
  }
}

function portalSessionTtlMs() {
  const configured = Number(process.env.GIB_PORTAL_SESSION_TTL_SECONDS ?? DEFAULT_PORTAL_SESSION_TTL_SECONDS);
  const seconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PORTAL_SESSION_TTL_SECONDS;
  return seconds * 1000;
}

function portalProxySessionTtlMs() {
  const configured = Number(process.env.GIB_PORTAL_PROXY_SESSION_TTL_SECONDS ?? DEFAULT_PORTAL_PROXY_SESSION_TTL_SECONDS);
  const seconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PORTAL_PROXY_SESSION_TTL_SECONDS;
  return seconds * 1000;
}

function loginEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/assos-login`;
}

function dispatchEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/dispatch`;
}

function tokenFromLaunchSession(session: CachedPortalLaunchSession | undefined) {
  if (session?.token?.trim()) return session.token.trim();
  if (!session?.launchUrl) return undefined;

  try {
    const token = new URL(session.launchUrl).searchParams.get("token")?.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function proxySessionKey(sessionId: string) {
  return `${GIB_PORTAL_PROXY_SESSION_PREFIX}.${sessionId}`;
}

function setCookieValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function cookieJarFromSetCookie(values: string[], base: Record<string, string> = {}) {
  const output = { ...base };

  for (const value of values) {
    const [pair, ...attributes] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;

    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    const shouldDelete = attributes.some((attribute) => /^max-age=0$/i.test(attribute.trim())) || !cookieValue;

    if (shouldDelete) {
      delete output[name];
    } else {
      output[name] = cookieValue;
    }
  }

  return output;
}

function cookieHeader(cookieJar: Record<string, string>) {
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function isTextContentType(contentType: string) {
  return (
    /^text\//i.test(contentType) ||
    /(?:json|javascript|ecmascript|xml|x-www-form-urlencoded)/i.test(contentType) ||
    /application\/(?:xhtml\+xml|rss\+xml|atom\+xml)/i.test(contentType)
  );
}

function isHtmlContentType(contentType: string) {
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function isCssContentType(contentType: string) {
  return /text\/css/i.test(contentType);
}

function safeHeaderValue(value: unknown) {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function shouldForwardRequestBody(method: string) {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function bodyForProxyRequest(request: Request) {
  if (!shouldForwardRequestBody(request.method)) return undefined;

  const body = request.body as unknown;
  const contentType = String(request.headers["content-type"] ?? "");

  if (Buffer.isBuffer(body) || typeof body === "string") return body;
  if (!body || typeof body !== "object") return undefined;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) form.append(key, String(item));
      } else if (value !== undefined && value !== null) {
        form.set(key, String(value));
      }
    }
    return form.toString();
  }

  return JSON.stringify(body);
}

function stripHopByHopHeaders(headers: Record<string, unknown>) {
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "set-cookie",
    "content-encoding",
    "content-length",
    "content-security-policy",
    "x-frame-options"
  ]);

  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function launchUrl(portalUrl: string, response: AssosLoginResponse) {
  if (!response.redirectUrl) {
    throw new ServiceUnavailableException("e-Arsiv portali giris yanitinda redirectUrl donmedi.");
  }

  const origin = new URL(portalUrl).origin;
  const target = new URL(response.redirectUrl, origin);
  if (response.token) target.searchParams.set("token", response.token);
  target.searchParams.set("v", String(Date.now()));
  return target.toString();
}

function formatPortalDate(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function findArrays(value: unknown, output: Record<string, unknown>[][] = []) {
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      output.push(value as Record<string, unknown>[]);
    }

    for (const item of value) findArrays(item, output);
    return output;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) findArrays(item, output);
  }

  return output;
}

function stringifyResponseData(response: DispatchResponse) {
  const value = response.data ?? response.result ?? response.rows ?? response;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function portalMessage(response: AssosLoginResponse) {
  return response.messages?.map((message) => message.text).find(Boolean);
}

function logoutPortalMessage(response: AssosLogoutResponse) {
  return response.messages?.map((message) => message.text).find(Boolean);
}

function isGibConcurrentSessionMessage(message: string) {
  return /birden fazla/i.test(message) && /güvenli|guvenli/i.test(message);
}

function successText(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase();

  return normalized.includes("basari");
}

function extractPortalUuid(value: unknown): string | undefined {
  if (typeof value === "string") {
    try {
      return normalizePortalEttn(value);
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractPortalUuid(item);
      if (candidate) return candidate;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["faturaUuid", "uuid", "ettn", "ETTN", "data", "result"]) {
      const candidate = extractPortalUuid(record[key]);
      if (candidate) return candidate;
    }

    for (const item of Object.values(record)) {
      const candidate = extractPortalUuid(item);
      if (candidate) return candidate;
    }
  }

  return undefined;
}

function portalRecordKey(record: Record<string, unknown>) {
  for (const key of ["faturaUuid", "uuid", "ettn", "ETTN", "belgeOid", "faturaOid", "faturaNo", "belgeNo", "seriSiraNo"]) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return JSON.stringify(record);
}

function normalizedPortalText(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function portalRecordPriority(record: Record<string, unknown>) {
  const command = String(record.kaynakKomut ?? record.sourceCommand ?? "");
  const statusText = normalizedPortalText(record.durum ?? record.status ?? record.belgeDurumu ?? record.onayDurumu ?? record.faturaDurumu);

  if (/iptal|silindi|hata|reddedildi/.test(statusText)) return -10;
  if (/ADIMA_KESILEN|KESILEN|ONAYLI/i.test(command)) return 20;
  if (/onaylandi|imzalandi|imzali|kesildi|duzenlendi|basarili/.test(statusText)) return 15;
  if (/taslak|onaylanmadi|onay bekliyor|imza bekliyor/.test(statusText)) return 0;
  return 1;
}

function dedupePortalRecords(records: Record<string, unknown>[]) {
  const byKey = new Map<string, Record<string, unknown>>();
  const keys: string[] = [];

  for (const record of records) {
    const key = portalRecordKey(record);
    const existing = byKey.get(key);
    if (!existing) {
      keys.push(key);
      byKey.set(key, record);
      continue;
    }

    if (portalRecordPriority(record) > portalRecordPriority(existing)) {
      byKey.set(key, record);
    }
  }

  return keys.map((key) => byKey.get(key)).filter((record): record is Record<string, unknown> => Boolean(record));
}

function shouldLetPortalGenerateUuid(payload: GibPortalInvoiceDraftPayload) {
  return payload.hangiTip === "5000/30000";
}

function payloadForDraftCreate(payload: GibPortalInvoiceDraftPayload, uuid?: string) {
  if (shouldLetPortalGenerateUuid(payload)) {
    const { faturaUuid: _faturaUuid, ...payloadWithoutUuid } = payload;
    return payloadWithoutUuid;
  }

  return { ...payload, faturaUuid: uuid ?? payload.faturaUuid };
}

@Injectable()
export class EarsivPortalService {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async openSession() {
    const connection = await this.getConnection();
    const cached = await this.readValidLaunchSession(connection.portalUrl);
    if (cached) return cached;

    try {
      const { launchSession } = await this.login("SAFA local e-arsiv portal launcher", connection);
      if (!launchSession) {
        throw new ServiceUnavailableException("e-Arsiv portali giris yanitinda redirectUrl donmedi.");
      }
      return launchSession;
    } catch (error) {
      if (error instanceof GibConcurrentSessionError) {
        const fallback = await this.readValidLaunchSession(connection.portalUrl);
        if (fallback) {
          return {
            ...fallback,
            lastPortalMessage: error.message,
            message: "Aktif e-Arsiv oturumu yeni sekmede acildi."
          };
        }

        throw new BadRequestException(
          "GIB aktif oturum bildirdi; SAFA'da kullanilabilir tokenli link yok. Portaldan Guvenli Cikis yapip tekrar deneyin."
        );
      }

      throw error;
    }
  }

  async logoutSession(): Promise<PortalLogoutResult> {
    const connection = await this.getConnection();
    const cached = await this.readLaunchSession();
    const token = tokenFromLaunchSession(cached);

    if (!token || cached?.portalUrl !== connection.portalUrl) {
      await this.expireLaunchSession(connection.portalUrl, "SAFA'nin kapatabilecegi aktif e-Arsiv oturum tokeni yok.");
      await this.expireLatestProxySession(connection.portalUrl);
      return {
        portalUrl: connection.portalUrl,
        attempted: false,
        ok: false,
        source: "none",
        message:
          "SAFA'nin kapatabilecegi aktif e-Arsiv oturumu yok. Portal baska sekmede veya cihazda aciksa oradan Guvenli Cikis yapin."
      };
    }

    try {
      const response = await this.logout(connection, token);
      await this.expireLaunchSession(connection.portalUrl, "e-Arsiv oturum cache'i guvenli cikis sonrasi temizlendi.");
      await this.expireLatestProxySession(connection.portalUrl);
      return {
        portalUrl: connection.portalUrl,
        attempted: true,
        ok: true,
        source: "cached-token",
        message: "SAFA e-Arsiv oturumunu kapatmayi denedi ve yerel token kaydini temizledi.",
        portalMessage: logoutPortalMessage(response)
      };
    } catch (error) {
      await this.expireLaunchSession(connection.portalUrl, "e-Arsiv oturum cache'i guvenli cikis hatasi sonrasi temizlendi.");
      await this.expireLatestProxySession(connection.portalUrl);
      return {
        portalUrl: connection.portalUrl,
        attempted: true,
        ok: false,
        source: "cached-token",
        message:
          "SAFA yerel e-Arsiv token kaydini temizledi ancak GIB cikisi dogrulanamadi. Portal hala aktif oturum bildirirse portalda manuel Guvenli Cikis yapin.",
        portalMessage: error instanceof Error ? error.message : undefined
      };
    }
  }

  async createProxySession(): Promise<PortalProxySessionResult> {
    const connection = await this.getConnection();

    try {
      const { response, launchSession, setCookie } = await this.login("SAFA live e-arsiv portal proxy", connection);
      if (!launchSession) {
        throw new ServiceUnavailableException("e-Arsiv portali giris yanitinda redirectUrl donmedi.");
      }
      return this.rememberProxySession(connection, launchSession.launchUrl, response.token, cookieJarFromSetCookie(setCookie ?? []));
    } catch (error) {
      if (error instanceof GibConcurrentSessionError) {
        const fallback = await this.readValidLaunchSessionForProxy(connection.portalUrl);
        if (fallback) {
          return this.rememberProxySession(connection, fallback.launchUrl, tokenFromLaunchSession(fallback), {});
        }
        throw new BadRequestException(
          "GIB aktif oturum bildirdi; SAFA proxy icin kullanilabilir token yok. Portaldan Guvenli Cikis yapip tekrar deneyin."
        );
      }

      throw error;
    }
  }

  async proxyPortalRequest(sessionId: string, request: Request, response: Response) {
    const session = await this.readValidProxySession(sessionId);
    if (!session) {
      response.status(410).send("e-Arsiv proxy oturumunun suresi doldu. SAFA'dan e-Arsiv ac ile tekrar deneyin.");
      return;
    }

    const targetUrl = this.targetUrlFromProxyRequest(session, request);
    const proxyHeaders = this.proxyRequestHeaders(session, request, targetUrl);
    const proxyResponse = await axios.request<ArrayBuffer | Buffer>({
      method: request.method,
      url: targetUrl.toString(),
      headers: proxyHeaders,
      data: bodyForProxyRequest(request),
      responseType: "arraybuffer",
      maxRedirects: 0,
      timeout: 30_000,
      validateStatus: () => true
    });

    const nextCookieJar = cookieJarFromSetCookie(setCookieValues(proxyResponse.headers["set-cookie"]), session.cookieJar);
    const nextSession: CachedPortalProxySession = {
      ...session,
      cookieJar: nextCookieJar,
      lastTargetUrl: targetUrl.toString()
    };
    await this.writeProxySession(nextSession);

    const context = this.proxyRewriteContext(session);
    const headers = stripHopByHopHeaders(proxyResponse.headers as Record<string, unknown>);
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) response.setHeader(key, value as string | number | readonly string[]);
    }

    const location = safeHeaderValue(proxyResponse.headers.location);
    if (location) {
      response.setHeader("Location", proxiedPortalUrl(context, location, targetUrl.toString()));
    }

    response.setHeader("Cache-Control", "no-store");
    response.status(proxyResponse.status);

    if (request.method === "HEAD" || proxyResponse.status === 204 || proxyResponse.status === 304) {
      response.end();
      return;
    }

    const responseData = proxyResponse.data;
    const body = Buffer.isBuffer(responseData) ? responseData : Buffer.from(new Uint8Array(responseData));
    const contentType = safeHeaderValue(proxyResponse.headers["content-type"]) ?? "";

    if (isHtmlContentType(contentType)) {
      response.send(rewritePortalHtml(context, body.toString("utf8"), targetUrl.toString()));
      return;
    }

    if (isCssContentType(contentType)) {
      response.send(rewritePortalText(context, body.toString("utf8"), targetUrl.toString()));
      return;
    }

    if (isTextContentType(contentType)) {
      response.send(body.toString("utf8"));
      return;
    }

    response.end(body);
  }

  async listIssuedInvoices(startDate: Date, endDate: Date) {
    const { connection, response } = await this.loginForOperation("SAFA live e-arsiv invoice query");
    if (!response.token) {
      throw new ServiceUnavailableException("e-Arsiv portali oturum tokeni donmedi; harici fatura sorgusu baslatilamadi.");
    }

    const start = formatPortalDate(startDate);
    const end = formatPortalDate(endDate);
    const queryPayload = {
      baslangic: start,
      bitis: end,
      hangiTip: "5000/30000",
      table: []
    };

    const candidates = [
      { cmd: "EARSIV_PORTAL_TASLAKLARI_GETIR", pageName: "RG_TASLAKLAR" },
      { cmd: "EARSIV_PORTAL_TASLAKLARI_GETIR", pageName: "RG_BASITTASLAKLAR" },
      { cmd: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR", pageName: "RG_ALICI_TASLAKLAR" }
    ];

    const failures: string[] = [];
    const records: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
      const dispatch = await this.dispatch(connection, response.token, candidate.cmd, candidate.pageName, queryPayload);
      if (dispatch.error) {
        failures.push(`${candidate.cmd}: ${JSON.stringify(dispatch.error)}`);
        continue;
      }

      const arrays = findArrays(dispatch.data ?? dispatch.result ?? dispatch.rows ?? dispatch);
      const rows = arrays.sort((left, right) => right.length - left.length)[0] ?? [];
      records.push(
        ...rows.map((row) => ({
          ...row,
          sorguBaslangic: start,
          sorguBitis: end,
          kaynakKomut: candidate.cmd,
          kaynakSayfa: candidate.pageName
        }))
      );
    }

    if (records.length > 0) return dedupePortalRecords(records);

    throw new ServiceUnavailableException(
      `e-Arsiv portal fatura sorgusu calismadi. Portal cevap verdi fakat desteklenen fatura liste komutu bulunamadi. Denenenler: ${failures.join(" | ")}`
    );
  }

  async createInvoiceDrafts(inputs: PortalDraftUploadInput[]): Promise<PortalDraftUploadResult[]> {
    if (inputs.length === 0) return [];

    const { connection, response } = await this.loginForOperation("SAFA live e-arsiv portal draft upload");
    if (!response.token) {
      throw new ServiceUnavailableException("e-Arsiv portali oturum tokeni donmedi; portal taslagi yuklenemedi.");
    }

    const command = "EARSIV_PORTAL_FATURA_OLUSTUR";
    const pageName = "RG_BASITFATURA";
    const results: PortalDraftUploadResult[] = [];

    for (const input of inputs) {
      try {
        const portalUuid = shouldLetPortalGenerateUuid(input.payload)
          ? undefined
          : await this.getPortalInvoiceUuid(connection, response.token);
        const payload = payloadForDraftCreate(input.payload, portalUuid);
        const dispatch = await this.dispatch(
          connection,
          response.token,
          command,
          pageName,
          payload as unknown as Record<string, unknown>,
          "SAFA live e-arsiv portal draft upload"
        );
        const message = stringifyResponseData(dispatch);
        const errorMessage = dispatch.error ? JSON.stringify(dispatch.error) : undefined;
        const ok = !dispatch.error && successText(message);
        const responseUuid = extractPortalUuid(dispatch.data ?? dispatch.result ?? dispatch.rows ?? dispatch) ?? portalUuid;

        results.push({
          localDraftId: input.localDraftId,
          ok,
          uuid: responseUuid,
          attemptedUuid: portalUuid,
          documentNumber: payload.belgeNumarasi || undefined,
          status: ok ? "Onaylanmadı" : "YUKLEME_HATASI",
          message,
          command,
          pageName,
          response: dispatch,
          error: ok ? undefined : errorMessage ?? message
        });
      } catch (error) {
        results.push({
          localDraftId: input.localDraftId,
          ok: false,
          uuid: input.payload.faturaUuid,
          attemptedUuid: input.payload.faturaUuid,
          status: "YUKLEME_HATASI",
          command,
          pageName,
          error: error instanceof Error ? error.message : "e-Arsiv portal taslagi yuklenemedi."
        });
      }
    }

    return results;
  }

  private async rememberProxySession(
    connection: GibPortalConnection,
    launchUrlValue: string,
    token: string | undefined,
    cookieJar: Record<string, string>
  ): Promise<PortalProxySessionResult> {
    const openedAt = new Date();
    const sessionId = randomUUID();
    const portalOrigin = new URL(connection.portalUrl).origin;
    const session: CachedPortalProxySession = {
      sessionId,
      portalUrl: connection.portalUrl,
      portalOrigin,
      launchUrl: launchUrlValue,
      ...(token ? { token } : {}),
      cookieJar,
      openedAt: openedAt.toISOString(),
      expiresAt: new Date(openedAt.getTime() + portalProxySessionTtlMs()).toISOString(),
      lastTargetUrl: launchUrlValue
    };

    await this.writeProxySession(session);
    await this.settings.writeEncryptedSetting<CachedPortalProxyIndex>(GIB_PORTAL_PROXY_LATEST_SESSION_KEY, {
      sessionId,
      portalUrl: connection.portalUrl,
      expiresAt: session.expiresAt
    });

    return {
      proxyUrl: this.proxyUrlForTarget(session, launchUrlValue),
      expiresAt: session.expiresAt,
      message: "e-Arsiv portali SAFA proxy oturumuyla acildi."
    };
  }

  private proxyRewriteContext(session: CachedPortalProxySession): PortalProxyRewriteContext {
    return {
      sessionId: session.sessionId,
      portalOrigin: session.portalOrigin,
      proxyPrefix: `/api/earsiv-portal/proxy/${encodeURIComponent(session.sessionId)}`
    };
  }

  private proxyUrlForTarget(session: CachedPortalProxySession, targetUrl: string) {
    return proxiedPortalUrl(this.proxyRewriteContext(session), targetUrl, session.launchUrl);
  }

  private targetUrlFromProxyRequest(session: CachedPortalProxySession, request: Request) {
    const requestUrl = new URL(request.originalUrl, session.portalOrigin);
    const proxyPrefix = `/api/earsiv-portal/proxy/${encodeURIComponent(session.sessionId)}`;
    let targetPath = requestUrl.pathname.slice(proxyPrefix.length);
    if (!targetPath) targetPath = "/";
    if (!targetPath.startsWith("/")) targetPath = `/${targetPath}`;
    if (targetPath.startsWith("//")) {
      throw new BadRequestException("e-Arsiv proxy sadece kayitli GIB portal adresine istek atabilir.");
    }

    const target = new URL(`${targetPath}${requestUrl.search}`, session.portalOrigin);
    if (target.origin !== session.portalOrigin) {
      throw new BadRequestException("e-Arsiv proxy sadece kayitli GIB portal adresine istek atabilir.");
    }

    return target;
  }

  private proxyRequestHeaders(session: CachedPortalProxySession, request: Request, targetUrl: URL) {
    const headers: Record<string, string> = {
      Accept: safeHeaderValue(request.headers.accept) ?? "*/*",
      "Accept-Language": safeHeaderValue(request.headers["accept-language"]) ?? "tr,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: session.lastTargetUrl ?? session.launchUrl,
      "User-Agent": safeHeaderValue(request.headers["user-agent"]) ?? "SAFA e-arsiv portal proxy"
    };

    const contentType = safeHeaderValue(request.headers["content-type"]);
    if (contentType && shouldForwardRequestBody(request.method)) headers["Content-Type"] = contentType;
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) headers.Origin = targetUrl.origin;

    const cookies = cookieHeader(session.cookieJar);
    if (cookies) headers.Cookie = cookies;

    return headers;
  }

  private async readValidLaunchSessionForProxy(portalUrl: string): Promise<CachedPortalLaunchSession | undefined> {
    const cached = await this.readLaunchSession();
    if (!cached?.launchUrl || cached.portalUrl !== portalUrl || !tokenFromLaunchSession(cached)) return undefined;
    const expiresAt = new Date(cached.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
    return cached;
  }

  private async readValidProxySession(sessionId: string): Promise<CachedPortalProxySession | undefined> {
    try {
      const cached = await this.settings.readEncryptedSetting<CachedPortalProxySession>(proxySessionKey(sessionId));
      if (!cached?.sessionId || cached.sessionId !== sessionId || !cached.portalOrigin) return undefined;
      const expiresAt = new Date(cached.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;
      return cached;
    } catch {
      return undefined;
    }
  }

  private async writeProxySession(session: CachedPortalProxySession) {
    await this.settings.writeEncryptedSetting(proxySessionKey(session.sessionId), session);
  }

  private async expireLatestProxySession(portalUrl: string) {
    try {
      const latest = await this.settings.readEncryptedSetting<CachedPortalProxyIndex>(GIB_PORTAL_PROXY_LATEST_SESSION_KEY);
      if (!latest?.sessionId || latest.portalUrl !== portalUrl) return;

      const expiresAt = new Date(Date.now() - 1000).toISOString();
      const cached = await this.settings.readEncryptedSetting<CachedPortalProxySession>(proxySessionKey(latest.sessionId));
      if (cached?.sessionId === latest.sessionId) {
        await this.writeProxySession({
          ...cached,
          cookieJar: {},
          expiresAt
        });
      }

      await this.settings.writeEncryptedSetting<CachedPortalProxyIndex>(GIB_PORTAL_PROXY_LATEST_SESSION_KEY, {
        sessionId: latest.sessionId,
        portalUrl,
        expiresAt
      });
    } catch {
      return;
    }
  }

  private async getConnection() {
    const connection = await this.settings.getGibPortalConnection();
    if (!connection?.username || !connection.password) {
      throw new BadRequestException("e-Arsiv portal kullanici adi ve sifre once Baglantilar bolumunden kaydedilmeli.");
    }

    return connection;
  }

  private async loginForOperation(userAgent: string) {
    try {
      return await this.login(userAgent);
    } catch (error) {
      if (error instanceof GibConcurrentSessionError) {
        throw new BadRequestException(
          "GIB aktif oturum bildirdi. SAFA'dan e-Arsiv ac ile mevcut tokenli oturumu acin veya portaldan Guvenli Cikis yapip tekrar deneyin."
        );
      }

      throw error;
    }
  }

  private async login(
    userAgent: string,
    inputConnection?: GibPortalConnection
  ): Promise<{ connection: GibPortalConnection; response: AssosLoginResponse; launchSession?: PortalLaunchSession; setCookie?: string[] }> {
    const connection = inputConnection ?? (await this.getConnection());
    const form = new URLSearchParams({
      assoscmd: "anologin",
      rtype: "json",
      userid: connection.username,
      sifre: connection.password,
      sifre2: connection.password,
      parola: "1"
    });

    const response = await axios.post<AssosLoginResponse>(loginEndpoint(connection.portalUrl), form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        "User-Agent": userAgent
      },
      timeout: 30_000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ServiceUnavailableException(`e-Arsiv portal girisi HTTP ${response.status} dondu.`);
    }

    if (response.data?.error) {
      const message = response.data.messages?.[0]?.text ?? "e-Arsiv portal girisi basarisiz. Kullanici kodu veya sifreyi kontrol edin.";
      if (isGibConcurrentSessionMessage(message)) {
        throw new GibConcurrentSessionError(message);
      }
      throw new BadRequestException(message);
    }

    const launchSession = await this.rememberLaunchSession(connection, response.data, portalMessage(response.data));
    return { connection, response: response.data, launchSession, setCookie: setCookieValues(response.headers?.["set-cookie"]) };
  }

  private async logout(connection: GibPortalConnection, token: string) {
    const attempts = ["logout", "anologin"];
    let lastError: Error | undefined;

    for (const assoscmd of attempts) {
      const form = new URLSearchParams({
        assoscmd,
        rtype: "json",
        token
      });

      const response = await axios.post<AssosLogoutResponse>(loginEndpoint(connection.portalUrl), form.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          "User-Agent": "SAFA live e-arsiv portal logout"
        },
        timeout: 30_000,
        validateStatus: () => true
      });

      if (response.status < 200 || response.status >= 300) {
        lastError = new ServiceUnavailableException(`e-Arsiv portal guvenli cikisi HTTP ${response.status} dondu.`);
        continue;
      }

      if (response.data?.error) {
        lastError = new BadRequestException(logoutPortalMessage(response.data) ?? "e-Arsiv portal guvenli cikisi basarisiz.");
        continue;
      }

      return response.data;
    }

    throw lastError ?? new ServiceUnavailableException("e-Arsiv portal guvenli cikisi basarisiz.");
  }

  private async readValidLaunchSession(portalUrl: string): Promise<PortalLaunchSession | undefined> {
    const cached = await this.readLaunchSession();

    if (!cached?.launchUrl || cached.portalUrl !== portalUrl) return undefined;
    const expiresAt = new Date(cached.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined;

    return {
      ...cached,
      source: "cached",
      message: "Aktif e-Arsiv oturumu yeni sekmede acildi."
    };
  }

  private async readLaunchSession(): Promise<CachedPortalLaunchSession | undefined> {
    try {
      return await this.settings.readEncryptedSetting<CachedPortalLaunchSession>(GIB_PORTAL_LAUNCH_SESSION_KEY);
    } catch {
      return undefined;
    }
  }

  private async expireLaunchSession(portalUrl: string, message: string) {
    const now = new Date();
    await this.settings.writeEncryptedSetting<CachedPortalLaunchSession>(GIB_PORTAL_LAUNCH_SESSION_KEY, {
      portalUrl,
      launchUrl: "",
      tokenReceived: false,
      openedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() - 1000).toISOString(),
      source: "fresh",
      message
    });
  }

  private async rememberLaunchSession(
    connection: GibPortalConnection,
    response: AssosLoginResponse,
    lastPortalMessage?: string
  ): Promise<PortalLaunchSession | undefined> {
    if (!response.redirectUrl) return undefined;

    const openedAt = new Date();
    const tokenReceived = Boolean(response.token);
    const cached: CachedPortalLaunchSession = {
      portalUrl: connection.portalUrl,
      launchUrl: launchUrl(connection.portalUrl, response),
      ...(response.token ? { token: response.token } : {}),
      tokenReceived,
      openedAt: openedAt.toISOString(),
      expiresAt: new Date(openedAt.getTime() + portalSessionTtlMs()).toISOString(),
      source: "fresh",
      message: tokenReceived ? "e-Arsiv portali tokenli oturumla acildi." : "e-Arsiv portali acildi.",
      lastPortalMessage
    };

    await this.settings.writeEncryptedSetting(GIB_PORTAL_LAUNCH_SESSION_KEY, cached);
    return cached;
  }

  private async getPortalInvoiceUuid(connection: GibPortalConnection, token: string) {
    const dispatch = await this.dispatch(
      connection,
      token,
      "EARSIV_PORTAL_UUID_GETIR",
      undefined,
      {},
      "SAFA live e-arsiv portal UUID"
    );
    const portalUuid = extractPortalUuid(dispatch.data ?? dispatch.result ?? dispatch.rows ?? dispatch);

    if (!portalUuid) {
      throw new ServiceUnavailableException(`GIB portali taslak ETTN uretmedi. Yanit: ${stringifyResponseData(dispatch).slice(0, 240)}`);
    }

    return portalUuid;
  }

  private async dispatch(
    connection: GibPortalConnection,
    token: string,
    cmd: string,
    pageName: string | undefined,
    jp: Record<string, unknown>,
    userAgent = "SAFA live e-arsiv invoice query"
  ) {
    const form = new URLSearchParams({
      cmd,
      callid: randomUUID(),
      token,
      jp: JSON.stringify(jp)
    });
    if (pageName) form.set("pageName", pageName);

    const response = await axios.post<DispatchResponse>(dispatchEndpoint(connection.portalUrl), form.toString(), {
      headers: {
        Accept: "*/*",
        "Accept-Language": "tr,en-US;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Pragma: "no-cache",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": userAgent
      },
      timeout: 30_000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ServiceUnavailableException(`e-Arsiv portal dispatch HTTP ${response.status} dondu.`);
    }

    return response.data;
  }
}
