import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { SettingsService } from "../settings/settings.service";
import type { GibPortalConnection } from "../settings/connection-types";

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

  private async dispatch(connection: GibPortalConnection, token: string, cmd: string, pageName: string, jp: Record<string, unknown>) {
    const form = new URLSearchParams({
      cmd,
      callid: randomUUID(),
      pageName,
      token,
      jp: JSON.stringify(jp)
    });

    const response = await axios.post<DispatchResponse>(dispatchEndpoint(connection.portalUrl), form.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        "User-Agent": "SAFA live e-arsiv invoice query"
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
