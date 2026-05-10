import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import axios from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { envBool } from "../common/env";
import { PrismaService } from "../prisma/prisma.service";
import {
  GibDirectConnection,
  GibDirectEnvironment,
  GibDirectSignerMode,
  GibPortalConnection,
  StoredSecret,
  TrendyolConnection
} from "./connection-types";

const TRENDYOL_CONNECTION_KEY = "connection.trendyol";
const GIB_PORTAL_CONNECTION_KEY = "connection.gibPortal";
const GIB_DIRECT_CONNECTION_KEY = "connection.gibDirect";
const GIB_DIRECT_SEQUENCE_PREFIX = "sequence.gibDirect";

type JsonObject = Record<string, unknown>;

interface AssosLoginResponse {
  token?: string;
  redirectUrl?: string;
  error?: unknown;
  messages?: Array<{ text?: string }>;
}

interface TrendyolStreamResponse {
  content?: unknown[];
  hasMore?: boolean;
  nextCursor?: string;
}

interface ConnectionHealth {
  provider: "trendyol" | "gib-portal" | "gib-direct";
  connected: true;
  checkedAt: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GibDirectReadiness {
  configured: boolean;
  ready: boolean;
  mode: GibDirectEnvironment;
  signerMode: GibDirectSignerMode;
  source: "app" | "env" | "none";
  missing: string[];
  message: string;
}

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

function normalizeEnvironment(value?: string): GibDirectEnvironment {
  return value === "prod" ? "prod" : "test";
}

function normalizeSignerMode(value?: string): GibDirectSignerMode {
  if (value && value !== "external-command") {
    throw new BadRequestException("GIB direct imzalama modu su an sadece external-command olabilir.");
  }

  return "external-command";
}

function optionalEnv(key: string) {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function hasInputOutputPlaceholders(command?: string) {
  return Boolean(command?.includes("{input}") && command.includes("{output}"));
}

function hasSignedXmlPlaceholder(template?: string) {
  return Boolean(template && /\{signedXml(?:Escaped|Cdata|Base64)?\}/.test(template));
}

function keepExistingSensitiveValue(inputValue: unknown, existingValue?: string) {
  const next = typeof inputValue === "string" ? inputValue.trim() : "";
  return next || existingValue?.trim() || undefined;
}

function isGibConcurrentSessionMessage(message: string) {
  return /birden fazla/i.test(message) && /güvenli|guvenli/i.test(message);
}

function envGibDirectConnection(): GibDirectConnection | undefined {
  const taxId = optionalEnv("GIB_EARSIV_TAX_ID");
  const serviceUrl = optionalEnv("GIB_EARSIV_SERVICE_URL");
  const signerCommand = optionalEnv("GIB_EARSIV_SIGNER_COMMAND");
  const soapSignerCommand = optionalEnv("GIB_EARSIV_SOAP_SIGNER_COMMAND");
  const invoicePrefix = optionalEnv("GIB_EARSIV_INVOICE_PREFIX");
  const nextInvoiceSequence = Number(process.env.GIB_EARSIV_NEXT_SEQUENCE ?? 1);

  if (!taxId && !serviceUrl && !signerCommand && !soapSignerCommand && !invoicePrefix) return undefined;

  return {
    environment: normalizeEnvironment(process.env.GIB_EARSIV_ENV),
    taxId: taxId ?? "",
    serviceUrl: serviceUrl ?? "",
    wsdlUrl: optionalEnv("GIB_EARSIV_WSDL_URL"),
    soapAction: optionalEnv("GIB_EARSIV_SOAP_ACTION"),
    soapBodyTemplate: optionalEnv("GIB_EARSIV_SOAP_BODY_TEMPLATE"),
    soapBodyTemplatePath: optionalEnv("GIB_EARSIV_SOAP_BODY_TEMPLATE_PATH"),
    signerMode: normalizeSignerMode(process.env.GIB_EARSIV_SIGNER_MODE),
    signerCommand: signerCommand ?? "",
    soapSignerCommand: soapSignerCommand ?? "",
    invoicePrefix: invoicePrefix ?? "SAF",
    nextInvoiceSequence,
    unitCode: optionalEnv("GIB_EARSIV_UNIT_CODE") ?? "C62",
    defaultBuyerTckn: optionalEnv("GIB_EARSIV_DEFAULT_BUYER_TCKN") ?? "11111111111",
    testAccessConfirmed: envBool("GIB_EARSIV_TEST_ACCESS_CONFIRMED"),
    productionAccessConfirmed: envBool("GIB_EARSIV_PRODUCTION_ACCESS_CONFIRMED"),
    authorizationReference: optionalEnv("GIB_EARSIV_AUTHORIZATION_REFERENCE"),
    clientCertPath: optionalEnv("GIB_EARSIV_CLIENT_CERT_PATH"),
    clientKeyPath: optionalEnv("GIB_EARSIV_CLIENT_KEY_PATH"),
    clientPfxPath: optionalEnv("GIB_EARSIV_CLIENT_PFX_PATH"),
    clientCertPassword: optionalEnv("GIB_EARSIV_CLIENT_CERT_PASSWORD")
  };
}

function resolveGibDirectReadiness(connection: GibDirectConnection | undefined, source: "app" | "env" | "none"): GibDirectReadiness {
  const missing: string[] = [];

  if (!connection?.taxId) missing.push("GIB vergi kimlik no");
  if (connection?.taxId && !/^\d{10,11}$/.test(connection.taxId)) missing.push("GIB VKN/TCKN 10 veya 11 haneli olmali");
  if (!connection?.serviceUrl) missing.push("GIB servis URL");
  if (connection?.serviceUrl && !connection.serviceUrl.startsWith("https://")) missing.push("GIB servis URL HTTPS olmali");
  if (!connection?.invoicePrefix) missing.push("Fatura seri prefix");
  if (connection?.invoicePrefix && !/^[A-Z]{3}$/.test(connection.invoicePrefix)) missing.push("Fatura seri prefix 3 buyuk harf olmali");
  if (!connection?.nextInvoiceSequence || connection.nextInvoiceSequence < 1) missing.push("Fatura sira numarasi");
  if (!connection?.signerCommand) missing.push("Mali muhur/NES imzalama komutu");
  if (connection?.signerCommand && !hasInputOutputPlaceholders(connection.signerCommand)) {
    missing.push("Mali muhur/NES imzalama komutu {input} ve {output} icermeli");
  }
  if (!connection?.soapSignerCommand) missing.push("GIB SOAP/WSS imzalama komutu");
  if (connection?.soapSignerCommand && !hasInputOutputPlaceholders(connection.soapSignerCommand)) {
    missing.push("GIB SOAP/WSS imzalama komutu {input} ve {output} icermeli");
  }
  if (!connection?.soapBodyTemplate && !connection?.soapBodyTemplatePath) missing.push("GIB SOAP govde sablonu");
  if (connection?.soapBodyTemplate && !hasSignedXmlPlaceholder(connection.soapBodyTemplate)) {
    missing.push("GIB SOAP govde sablonu imzali XML yer tutucusu icermeli");
  }
  if (connection?.clientCertPath && !connection.clientKeyPath) missing.push("GIB client key dosya yolu");
  if (connection?.clientKeyPath && !connection.clientCertPath) missing.push("GIB client sertifika dosya yolu");
  if (connection && !connection.testAccessConfirmed) missing.push("GIB test entegrasyon erisimi/onayi teyidi");
  if (connection?.environment === "prod" && !connection.productionAccessConfirmed) missing.push("GIB canli entegrasyon izin yazisi teyidi");

  const ready = Boolean(connection) && missing.length === 0;

  return {
    configured: Boolean(connection),
    ready,
    mode: connection?.environment ?? "test",
    signerMode: connection?.signerMode ?? "external-command",
    source,
    missing,
    message: ready
      ? "GIB direct canli fatura kesimi icin servis ve imza ayarlari tamam."
      : missing.length > 0
        ? `GIB direct icin eksik ayar var: ${missing.join(", ")}.`
        : "GIB direct ayarlari henuz tanimli degil."
  };
}

function loginEndpoint(portalUrl: string) {
  const url = new URL(portalUrl);
  return `${url.origin}/earsiv-services/assos-login`;
}

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async snapshot() {
    const persisted = await this.prisma.setting.findMany();
    const connections = await this.connections();
    const gibDirect = await this.gibDirectReadiness();
    return {
      runtime: {
        liveIntegrationsOnly: true,
        invoiceProvider: "gib-direct",
        autoSyncEnabled: envBool("AUTO_SYNC_ENABLED", false),
        trendyolConfigured: connections.trendyol.configured,
        gibPortalConfigured: connections.gibPortal.configured,
        gibDirectConfigured: gibDirect.ready,
        gibDirectReadiness: gibDirect,
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
    const gibDirect = await this.getGibDirectConnection();
    const gibDirectSource = gibDirect ? (await this.hasStoredSecret(GIB_DIRECT_CONNECTION_KEY) ? "app" : "env") : "none";
    const gibDirectReadiness = resolveGibDirectReadiness(gibDirect, gibDirectSource);

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
      },
      gibDirect: {
        configured: gibDirectReadiness.configured,
        ready: gibDirectReadiness.ready,
        source: gibDirectReadiness.source,
        environment: gibDirectReadiness.mode,
        signerMode: gibDirectReadiness.signerMode,
        taxId: gibDirect?.taxId ?? "",
        serviceUrl: gibDirect?.serviceUrl ?? "",
        wsdlUrl: gibDirect?.wsdlUrl ?? "",
        soapAction: gibDirect?.soapAction ?? "",
        soapBodyTemplateSaved: Boolean(gibDirect?.soapBodyTemplate || gibDirect?.soapBodyTemplatePath),
        signerCommandSaved: Boolean(gibDirect?.signerCommand),
        soapSignerCommandSaved: Boolean(gibDirect?.soapSignerCommand),
        invoicePrefix: gibDirect?.invoicePrefix ?? "SAF",
        nextInvoiceSequence: gibDirect?.nextInvoiceSequence ?? 1,
        unitCode: gibDirect?.unitCode ?? "C62",
        defaultBuyerTckn: gibDirect?.defaultBuyerTckn ?? "11111111111",
        testAccessConfirmed: Boolean(gibDirect?.testAccessConfirmed),
        productionAccessConfirmed: Boolean(gibDirect?.productionAccessConfirmed),
        authorizationReference: gibDirect?.authorizationReference ?? "",
        clientCertificateConfigured: Boolean(gibDirect?.clientCertPath || gibDirect?.clientPfxPath),
        missing: gibDirectReadiness.missing,
        message: gibDirectReadiness.message
      }
    };
  }

  async gibDirectReadiness() {
    const connection = await this.getGibDirectConnection();
    const source = connection ? (await this.hasStoredSecret(GIB_DIRECT_CONNECTION_KEY) ? "app" : "env") : "none";
    return resolveGibDirectReadiness(connection, source);
  }

  async saveTrendyolConnection(input: Partial<TrendyolConnection>) {
    const next = await this.normalizeTrendyolConnection(input);

    await this.setEncryptedSetting(TRENDYOL_CONNECTION_KEY, next);
    return this.connections();
  }

  async connectTrendyol(input: Partial<TrendyolConnection>) {
    const next = await this.normalizeTrendyolConnection(input);
    const health = await this.testTrendyolConnection(next);

    await this.setEncryptedSetting(TRENDYOL_CONNECTION_KEY, next);

    return {
      connections: await this.connections(),
      health
    };
  }

  async saveGibPortalConnection(input: Partial<GibPortalConnection>) {
    const next = await this.normalizeGibPortalConnection(input);

    await this.setEncryptedSetting(GIB_PORTAL_CONNECTION_KEY, next);
    return this.connections();
  }

  async connectGibPortal(input: Partial<GibPortalConnection>) {
    const next = await this.normalizeGibPortalConnection(input);
    const health = await this.testGibPortalConnection(next);

    await this.setEncryptedSetting(GIB_PORTAL_CONNECTION_KEY, next);

    return {
      connections: await this.connections(),
      health
    };
  }

  async saveGibDirectConnection(input: Partial<GibDirectConnection>) {
    const next = await this.normalizeGibDirectConnection(input);

    await this.setEncryptedSetting(GIB_DIRECT_CONNECTION_KEY, next);
    return this.connections();
  }

  async connectGibDirect(input: Partial<GibDirectConnection>) {
    const next = await this.normalizeGibDirectConnection(input);
    const health = await this.testGibDirectConnection(next);

    await this.setEncryptedSetting(GIB_DIRECT_CONNECTION_KEY, next);

    return {
      connections: await this.connections(),
      health
    };
  }

  async getTrendyolConnection(): Promise<TrendyolConnection | undefined> {
    return (await this.getStoredSecret<TrendyolConnection>(TRENDYOL_CONNECTION_KEY)) ?? envTrendyolConnection();
  }

  async getGibPortalConnection(): Promise<GibPortalConnection | undefined> {
    return this.getStoredSecret<GibPortalConnection>(GIB_PORTAL_CONNECTION_KEY);
  }

  async getGibDirectConnection(): Promise<GibDirectConnection | undefined> {
    return (await this.getStoredSecret<GibDirectConnection>(GIB_DIRECT_CONNECTION_KEY)) ?? envGibDirectConnection();
  }

  async reserveGibDirectInvoiceNumber(connection: GibDirectConnection) {
    const year = new Date().getFullYear();
    const prefix = connection.invoicePrefix.trim().toUpperCase();
    const key = `${GIB_DIRECT_SEQUENCE_PREFIX}.${connection.taxId}.${prefix}.${year}`;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.setting.findUnique({ where: { key } });
      const currentSequence =
        current && typeof current.value === "object" && current.value && "next" in current.value
          ? Number((current.value as Record<string, unknown>).next)
          : Number(connection.nextInvoiceSequence || 1);
      const sequence = Number.isFinite(currentSequence) && currentSequence > 0 ? Math.floor(currentSequence) : 1;
      const next = sequence + 1;

      await tx.setting.upsert({
        where: { key },
        update: { value: { next, updatedAt: new Date().toISOString() } },
        create: { key, value: { next, updatedAt: new Date().toISOString() } }
      });

      return `${prefix}${year}${String(sequence).padStart(9, "0")}`;
    });
  }

  private async normalizeTrendyolConnection(input: Partial<TrendyolConnection>) {
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
      throw new BadRequestException("Trendyol icin satici ID, API key ve API secret zorunlu.");
    }

    return next;
  }

  private async normalizeGibPortalConnection(input: Partial<GibPortalConnection>) {
    const current = await this.getStoredSecret<GibPortalConnection>(GIB_PORTAL_CONNECTION_KEY);
    const next: GibPortalConnection = {
      username: String(input.username ?? current?.username ?? "").trim(),
      password: String(input.password || current?.password || "").trim(),
      portalUrl: String(input.portalUrl ?? current?.portalUrl ?? "https://earsivportal.efatura.gov.tr/intragiris.html").trim()
    };

    if (!next.username || !next.password) {
      throw new BadRequestException("e-Arsiv icin kullanici kodu ve sifre zorunlu.");
    }

    return next;
  }

  private async normalizeGibDirectConnection(input: Partial<GibDirectConnection>) {
    const current = await this.getStoredSecret<GibDirectConnection>(GIB_DIRECT_CONNECTION_KEY);
    const envCurrent = envGibDirectConnection();
    const base = current ?? envCurrent;
    const next: GibDirectConnection = {
      environment: normalizeEnvironment(String(input.environment ?? base?.environment ?? "test")),
      taxId: String(input.taxId ?? base?.taxId ?? "").replace(/\D/g, ""),
      serviceUrl: String(input.serviceUrl ?? base?.serviceUrl ?? "").trim(),
      wsdlUrl: String(input.wsdlUrl ?? base?.wsdlUrl ?? "").trim() || undefined,
      soapAction: String(input.soapAction ?? base?.soapAction ?? "").trim() || undefined,
      soapBodyTemplate: keepExistingSensitiveValue(input.soapBodyTemplate, base?.soapBodyTemplate),
      soapBodyTemplatePath: keepExistingSensitiveValue(input.soapBodyTemplatePath, base?.soapBodyTemplatePath),
      signerMode: normalizeSignerMode(String(input.signerMode ?? base?.signerMode ?? "external-command")),
      signerCommand: keepExistingSensitiveValue(input.signerCommand, base?.signerCommand) ?? "",
      soapSignerCommand: keepExistingSensitiveValue(input.soapSignerCommand, base?.soapSignerCommand) ?? "",
      invoicePrefix: String(input.invoicePrefix ?? base?.invoicePrefix ?? "SAF")
        .trim()
        .toLocaleUpperCase("tr-TR")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 3),
      nextInvoiceSequence: Number(input.nextInvoiceSequence ?? base?.nextInvoiceSequence ?? 1),
      unitCode: String(input.unitCode ?? base?.unitCode ?? "C62").trim() || "C62",
      defaultBuyerTckn: String(input.defaultBuyerTckn ?? base?.defaultBuyerTckn ?? "11111111111").replace(/\D/g, ""),
      testAccessConfirmed: Boolean(input.testAccessConfirmed ?? base?.testAccessConfirmed ?? false),
      productionAccessConfirmed: Boolean(input.productionAccessConfirmed ?? base?.productionAccessConfirmed ?? false),
      authorizationReference: String(input.authorizationReference ?? base?.authorizationReference ?? "").trim() || undefined,
      clientCertPath: keepExistingSensitiveValue(input.clientCertPath, base?.clientCertPath),
      clientKeyPath: keepExistingSensitiveValue(input.clientKeyPath, base?.clientKeyPath),
      clientPfxPath: keepExistingSensitiveValue(input.clientPfxPath, base?.clientPfxPath),
      clientCertPassword: keepExistingSensitiveValue(input.clientCertPassword, base?.clientCertPassword)
    };

    const readiness = resolveGibDirectReadiness(next, "app");
    if (readiness.missing.length > 0) {
      throw new BadRequestException(readiness.message);
    }

    return next;
  }

  private async testTrendyolConnection(connection: TrendyolConnection): Promise<ConnectionHealth> {
    const end = Date.now();
    const start = end - Math.max(1, connection.lookbackDays) * 24 * 60 * 60 * 1000;

    const response = await axios.get<TrendyolStreamResponse>(
      `${connection.baseUrl}/integration/order/sellers/${connection.sellerId}/orders/stream`,
      {
        auth: { username: connection.apiKey, password: connection.apiSecret },
        headers: {
          "User-Agent": connection.userAgent,
          storeFrontCode: connection.storefrontCode
        },
        params: {
          size: 1,
          packageItemStatuses: "Delivered",
          lastModifiedStartDate: start,
          lastModifiedEndDate: end
        },
        timeout: 30_000,
        validateStatus: () => true
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new BadRequestException("Trendyol baglantisi reddedildi. Satici ID, API key veya API secret hatali olabilir.");
    }

    if (response.status === 404) {
      throw new BadRequestException("Trendyol endpoint bulunamadi. Satici ID veya base URL bilgisini kontrol edin.");
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ServiceUnavailableException(`Trendyol API HTTP ${response.status} dondu. Trendyol tarafinda gecici hata veya yetki sorunu olabilir.`);
    }

    return {
      provider: "trendyol",
      connected: true,
      checkedAt: new Date().toISOString(),
      message: "Trendyol API baglantisi dogrulandi.",
      details: {
        checkedPackageCount: response.data.content?.length ?? 0,
        hasMore: Boolean(response.data.hasMore),
        source: "orders/stream"
      }
    };
  }

  private async testGibPortalConnection(connection: GibPortalConnection): Promise<ConnectionHealth> {
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
        "User-Agent": "SAFA local e-arsiv portal connector"
      },
      timeout: 30_000,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ServiceUnavailableException(`e-Arsiv portali HTTP ${response.status} dondu. Portal erisimi gecici olarak basarisiz olabilir.`);
    }

    if (response.data?.error) {
      const message = response.data.messages?.[0]?.text ?? "e-Arsiv portal girisi basarisiz. Kullanici kodu veya sifreyi kontrol edin.";
      if (isGibConcurrentSessionMessage(message)) {
        return {
          provider: "gib-portal",
          connected: true,
          checkedAt: new Date().toISOString(),
          message:
            "e-Arsiv portal bilgileri kaydedildi. GIB portali ayni kullanici icin acik oturum bildirdi; tokenli oturum ve taslak yukleme icin portaldan Guvenli Cikis yapin.",
          details: {
            tokenReceived: false,
            redirectReceived: false,
            activeSessionConflict: true,
            portalMessage: message
          }
        };
      }

      throw new BadRequestException(message);
    }

    if (!response.data?.token && !response.data?.redirectUrl) {
      throw new ServiceUnavailableException("e-Arsiv portali cevap verdi ama oturum tokeni veya yonlendirme bilgisi donmedi.");
    }

    return {
      provider: "gib-portal",
      connected: true,
      checkedAt: new Date().toISOString(),
      message: "e-Arsiv portal baglantisi dogrulandi.",
      details: {
        tokenReceived: Boolean(response.data.token),
        redirectReceived: Boolean(response.data.redirectUrl)
      }
    };
  }

  private async testGibDirectConnection(connection: GibDirectConnection): Promise<ConnectionHealth> {
    const readiness = resolveGibDirectReadiness(connection, "app");
    if (!readiness.ready) {
      throw new BadRequestException(readiness.message);
    }

    await this.validateGibDirectLocalFiles(connection);

    const response = await axios.request({
      method: "GET",
      url: connection.wsdlUrl || connection.serviceUrl,
      timeout: 20_000,
      validateStatus: () => true
    });

    if (response.status >= 500) {
      throw new ServiceUnavailableException(`GIB direct servis HTTP ${response.status} dondu. Servis adresi veya GIB erisimi kontrol edilmeli.`);
    }

    return {
      provider: "gib-direct",
      connected: true,
      checkedAt: new Date().toISOString(),
      message: "GIB direct servis adresi ve imzalama ayarlari canli kesim icin hazir gorunuyor.",
      details: {
        environment: connection.environment,
        serviceStatus: response.status,
        serviceUrl: connection.serviceUrl,
        wsdlUrl: connection.wsdlUrl,
        signerMode: connection.signerMode,
        testAccessConfirmed: connection.testAccessConfirmed,
        productionAccessConfirmed: connection.productionAccessConfirmed
      }
    };
  }

  private async validateGibDirectLocalFiles(connection: GibDirectConnection) {
    const fileChecks = [
      { label: "GIB SOAP sablon dosyasi", path: connection.soapBodyTemplatePath },
      { label: "GIB client PFX dosyasi", path: connection.clientPfxPath },
      { label: "GIB client sertifika dosyasi", path: connection.clientCertPath },
      { label: "GIB client key dosyasi", path: connection.clientKeyPath }
    ].filter((item): item is { label: string; path: string } => Boolean(item.path));

    for (const item of fileChecks) {
      try {
        await fs.access(item.path);
      } catch {
        throw new BadRequestException(`${item.label} okunamadi: ${item.path}`);
      }
    }

    if (connection.soapBodyTemplatePath) {
      const template = await fs.readFile(connection.soapBodyTemplatePath, "utf8");
      if (!hasSignedXmlPlaceholder(template)) {
        throw new BadRequestException("GIB SOAP sablon dosyasi imzali XML yer tutucusu icermeli.");
      }
    }
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
