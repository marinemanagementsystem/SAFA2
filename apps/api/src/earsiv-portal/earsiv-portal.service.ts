import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { SettingsService } from "../settings/settings.service";
import type { GibPortalConnection } from "../settings/connection-types";
import type { GibPortalInvoiceDraftPayload } from "./portal-draft-payload";
import { normalizePortalEttn } from "./portal-draft-payload";

interface AssosLoginResponse {
  token?: string;
  redirectUrl?: string;
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

export interface PortalDraftUploadResult {
  localDraftId: string;
  ok: boolean;
  uuid: string;
  documentNumber?: string;
  status?: string;
  message?: string;
  command: string;
  pageName: string;
  response?: DispatchResponse;
  error?: string;
}

function loginEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/assos-login`;
}

function dispatchEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/dispatch`;
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

@Injectable()
export class EarsivPortalService {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async openSession() {
    const { connection, response } = await this.login("SAFA local e-arsiv portal launcher");

    return {
      portalUrl: connection.portalUrl,
      launchUrl: launchUrl(connection.portalUrl, response),
      tokenReceived: Boolean(response.token),
      openedAt: new Date().toISOString()
    };
  }

  async listIssuedInvoices(startDate: Date, endDate: Date) {
    const { connection, response } = await this.login("SAFA live e-arsiv invoice query");
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
    for (const candidate of candidates) {
      const dispatch = await this.dispatch(connection, response.token, candidate.cmd, candidate.pageName, queryPayload);
      if (dispatch.error) {
        failures.push(`${candidate.cmd}: ${JSON.stringify(dispatch.error)}`);
        continue;
      }

      const arrays = findArrays(dispatch.data ?? dispatch.result ?? dispatch.rows ?? dispatch);
      const rows = arrays.sort((left, right) => right.length - left.length)[0] ?? [];
      return rows.map((row) => ({
        ...row,
        sorguBaslangic: start,
        sorguBitis: end,
        kaynakKomut: candidate.cmd
      }));
    }

    throw new ServiceUnavailableException(
      `e-Arsiv portal fatura sorgusu calismadi. Portal cevap verdi fakat desteklenen fatura liste komutu bulunamadi. Denenenler: ${failures.join(" | ")}`
    );
  }

  async createInvoiceDrafts(inputs: PortalDraftUploadInput[]): Promise<PortalDraftUploadResult[]> {
    if (inputs.length === 0) return [];

    const { connection, response } = await this.login("SAFA live e-arsiv portal draft upload");
    if (!response.token) {
      throw new ServiceUnavailableException("e-Arsiv portali oturum tokeni donmedi; portal taslagi yuklenemedi.");
    }

    const command = "EARSIV_PORTAL_FATURA_OLUSTUR";
    const pageName = "RG_BASITFATURA";
    const results: PortalDraftUploadResult[] = [];

    for (const input of inputs) {
      try {
        const portalUuid = await this.getPortalInvoiceUuid(connection, response.token);
        const payload = { ...input.payload, faturaUuid: portalUuid };
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

        results.push({
          localDraftId: input.localDraftId,
          ok,
          uuid: payload.faturaUuid,
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
          status: "YUKLEME_HATASI",
          command,
          pageName,
          error: error instanceof Error ? error.message : "e-Arsiv portal taslagi yuklenemedi."
        });
      }
    }

    return results;
  }

  private async login(userAgent: string): Promise<{ connection: GibPortalConnection; response: AssosLoginResponse }> {
    const connection = await this.settings.getGibPortalConnection();
    if (!connection?.username || !connection.password) {
      throw new BadRequestException("e-Arsiv portal kullanici adi ve sifre once Baglantilar bolumunden kaydedilmeli.");
    }

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
      throw new BadRequestException(message);
    }

    return { connection, response: response.data };
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
