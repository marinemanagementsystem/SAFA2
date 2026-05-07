import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import { SettingsService } from "../settings/settings.service";

interface AssosLoginResponse {
  token?: string;
  redirectUrl?: string;
  error?: unknown;
  messages?: Array<{ text?: string }>;
}

function loginEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/assos-login`;
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

@Injectable()
export class EarsivPortalService {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async openSession() {
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
        "User-Agent": "SAFA local e-arsiv portal launcher"
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

    return {
      portalUrl: connection.portalUrl,
      launchUrl: launchUrl(connection.portalUrl, response.data),
      tokenReceived: Boolean(response.data.token),
      openedAt: new Date().toISOString()
    };
  }
}
