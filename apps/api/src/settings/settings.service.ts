import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { envBool } from "../common/env";
import { invoiceProviderKind } from "../invoice/providers/invoice-provider.token";
import { PrismaService } from "../prisma/prisma.service";
import { GibPortalConnection, StoredSecret, TrendyolConnection } from "./connection-types";

const TRENDYOL_CONNECTION_KEY = "connection.trendyol";
const GIB_PORTAL_CONNECTION_KEY = "connection.gibPortal";

type JsonObject = Record<string, unknown>;

function isEncryptedSecret(value: unknown): value is StoredSecret<unknown> {
  return Boolean(value && typeof value === "object" && (value as JsonObject).encrypted === true);
}

function mask(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

function envTrendyolConnection(): TrendyolConnection | undefined {
  const sellerId = process.env.TRENDYOL_SELLER_ID ?? "";
  const apiKey = process.env.TRENDYOL_API_KEY ?? "";
  const apiSecret = process.env.TRENDYOL_API_SECRET ?? "";
  if (!sellerId || !apiKey || !apiSecret) return undefined;

  return {
    sellerId,
    apiKey,
    apiSecret,
    userAgent: process.env.TRENDYOL_USER_AGENT ?? `SAFA-${sellerId}`,
    baseUrl: process.env.TRENDYOL_BASE_URL ?? "https://apigw.trendyol.com",
    storefrontCode: process.env.TRENDYOL_STOREFRONT_CODE ?? "TR",
    lookbackDays: Number(process.env.TRENDYOL_LOOKBACK_DAYS ?? 14)
  };
}

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async snapshot() {
    const persisted = await this.prisma.setting.findMany();
    const connections = await this.connections();
    return {
      runtime: {
        mockIntegrations: envBool("USE_MOCK_INTEGRATIONS", true),
        invoiceProvider: invoiceProviderKind(),
        autoSyncEnabled: envBool("AUTO_SYNC_ENABLED", false),
        trendyolConfigured: connections.trendyol.configured,
        gibPortalConfigured: connections.gibPortal.configured,
        gibDirectConfigured: Boolean(
          process.env.GIB_EARSIV_WSDL_URL &&
            process.env.GIB_EARSIV_SERVICE_URL &&
            process.env.GIB_EARSIV_TAX_ID &&
            process.env.GIB_EARSIV_CERT_PATH &&
            process.env.GIB_EARSIV_CERT_PASSWORD
        ),
        storageDir: process.env.STORAGE_DIR ?? "./storage"
      },
      persisted: persisted.map((item) => ({ key: item.key, updatedAt: item.updatedAt.toISOString() }))
    };
  }

  async upsert(key: string, value: unknown) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue },
      create: { key, value: value as Prisma.InputJsonValue }
    });
  }

  async connections() {
    const trendyol = await this.getTrendyolConnection();
    const gibPortal = await this.getGibPortalConnection();

    return {
      trendyol: {
        configured: Boolean(trendyol?.sellerId && trendyol.apiKey && trendyol.apiSecret),
        source: trendyol ? (await this.hasStoredSecret(TRENDYOL_CONNECTION_KEY) ? "app" : "env") : "none",
        sellerId: trendyol?.sellerId ?? "",
        apiKeyMasked: mask(trendyol?.apiKey),
        apiSecretSaved: Boolean(trendyol?.apiSecret),
        userAgent: trendyol?.userAgent ?? "SAFA local e-arsiv integration",
        baseUrl: trendyol?.baseUrl ?? "https://apigw.trendyol.com",
        storefrontCode: trendyol?.storefrontCode ?? "TR",
        lookbackDays: trendyol?.lookbackDays ?? 14
      },
      gibPortal: {
        configured: Boolean(gibPortal?.username && gibPortal.password),
        source: gibPortal ? "app" : "none",
        username: gibPortal?.username ?? "",
        passwordSaved: Boolean(gibPortal?.password),
        portalUrl: gibPortal?.portalUrl ?? "https://earsivportal.efatura.gov.tr/intragiris.html"
      }
    };
  }

  async saveTrendyolConnection(input: Partial<TrendyolConnection>) {
    const current = await this.getStoredSecret<TrendyolConnection>(TRENDYOL_CONNECTION_KEY);
    const next: TrendyolConnection = {
      sellerId: String(input.sellerId ?? current?.sellerId ?? "").trim(),
      apiKey: String(input.apiKey || current?.apiKey || "").trim(),
      apiSecret: String(input.apiSecret || current?.apiSecret || "").trim(),
      userAgent: String(input.userAgent ?? current?.userAgent ?? "SAFA local e-arsiv integration").trim(),
      baseUrl: String(input.baseUrl ?? current?.baseUrl ?? "https://apigw.trendyol.com").trim(),
      storefrontCode: String(input.storefrontCode ?? current?.storefrontCode ?? "TR").trim(),
      lookbackDays: Number(input.lookbackDays ?? current?.lookbackDays ?? 14)
    };

    if (!next.sellerId || !next.apiKey || !next.apiSecret) {
      throw new BadRequestException("Trendyol sellerId, apiKey ve apiSecret zorunlu.");
    }

    await this.setEncryptedSetting(TRENDYOL_CONNECTION_KEY, next);
    return this.connections();
  }

  async saveGibPortalConnection(input: Partial<GibPortalConnection>) {
    const current = await this.getStoredSecret<GibPortalConnection>(GIB_PORTAL_CONNECTION_KEY);
    const next: GibPortalConnection = {
      username: String(input.username ?? current?.username ?? "").trim(),
      password: String(input.password || current?.password || "").trim(),
      portalUrl: String(input.portalUrl ?? current?.portalUrl ?? "https://earsivportal.efatura.gov.tr/intragiris.html").trim()
    };

    if (!next.username || !next.password) {
      throw new BadRequestException("e-Arsiv portal kullanici adi ve sifre zorunlu.");
    }

    await this.setEncryptedSetting(GIB_PORTAL_CONNECTION_KEY, next);
    return this.connections();
  }

  async getTrendyolConnection(): Promise<TrendyolConnection | undefined> {
    return (await this.getStoredSecret<TrendyolConnection>(TRENDYOL_CONNECTION_KEY)) ?? envTrendyolConnection();
  }

  async getGibPortalConnection(): Promise<GibPortalConnection | undefined> {
    return this.getStoredSecret<GibPortalConnection>(GIB_PORTAL_CONNECTION_KEY);
  }

  private async hasStoredSecret(key: string) {
    return Boolean(await this.prisma.setting.findUnique({ where: { key } }));
  }

  private async setEncryptedSetting<T>(key: string, value: T) {
    const encrypted = this.encrypt(value);
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: encrypted as unknown as Prisma.InputJsonValue },
      create: { key, value: encrypted as unknown as Prisma.InputJsonValue }
    });
  }

  private async getStoredSecret<T>(key: string): Promise<T | undefined> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) return undefined;
    return this.decrypt<T>(setting.value);
  }

  private encrypt<T>(value: T): StoredSecret<T> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.secretKey(), iv);
    const plain = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      encrypted: true,
      version: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: encrypted.toString("base64"),
      updatedAt: new Date().toISOString()
    };
  }

  private decrypt<T>(value: Prisma.JsonValue): T {
    if (!isEncryptedSecret(value)) {
      throw new BadRequestException("Kayitli ayar sifreli formatta degil.");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.secretKey(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  }

  private secretKey() {
    const secret = process.env.APP_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException("APP_SECRET_KEY olmadan uygulama icinden sifre kaydedilemez.");
    }
    return createHash("sha256").update(secret).digest();
  }
}
