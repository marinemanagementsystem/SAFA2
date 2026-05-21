import { Inject, Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import { envNumber, requiredEnv } from "../common/env";
import { SettingsService } from "../settings/settings.service";

interface StreamResponse {
  content?: Record<string, unknown>[];
  hasMore?: boolean;
  nextCursor?: string;
}

interface DeliveredPackagePageInput {
  startDate?: string | number | Date;
  endDate?: string | number | Date;
  nextCursor?: string;
  size?: number;
}

function dateMillis(value: string | number | Date | undefined, fallback: number) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

@Injectable()
export class TrendyolService {
  private readonly logger = new Logger(TrendyolService.name);

  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async fetchDeliveredPackagePage(input: DeliveredPackagePageInput = {}): Promise<{
    content: Record<string, unknown>[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const credentials = await this.settings.getTrendyolConnection();

    if (!credentials) {
      requiredEnv("TRENDYOL_SELLER_ID");
    }

    const sellerId = credentials?.sellerId ?? requiredEnv("TRENDYOL_SELLER_ID");
    const apiKey = credentials?.apiKey ?? requiredEnv("TRENDYOL_API_KEY");
    const apiSecret = credentials?.apiSecret ?? requiredEnv("TRENDYOL_API_SECRET");
    const baseUrl = credentials?.baseUrl ?? process.env.TRENDYOL_BASE_URL ?? "https://apigw.trendyol.com";
    const storeFrontCode = credentials?.storefrontCode ?? process.env.TRENDYOL_STOREFRONT_CODE ?? "TR";
    const lookbackDays = credentials?.lookbackDays ?? envNumber("TRENDYOL_LOOKBACK_DAYS", 14);
    const fallbackEnd = Date.now();
    const fallbackStart = fallbackEnd - lookbackDays * 24 * 60 * 60 * 1000;
    const end = dateMillis(input.endDate, fallbackEnd);
    const start = dateMillis(input.startDate, fallbackStart);

    const response = await axios.get<StreamResponse>(`${baseUrl}/integration/order/sellers/${sellerId}/orders/stream`, {
      auth: { username: apiKey, password: apiSecret },
      headers: {
        "User-Agent": credentials?.userAgent ?? process.env.TRENDYOL_USER_AGENT ?? `SAFA-${sellerId}`,
        storeFrontCode
      },
      params: {
        size: input.size ?? 200,
        packageItemStatuses: "Delivered",
        lastModifiedStartDate: start,
        lastModifiedEndDate: end,
        ...(input.nextCursor ? { nextCursor: input.nextCursor } : {})
      },
      timeout: 30_000
    });

    return {
      content: response.data.content ?? [],
      hasMore: Boolean(response.data.hasMore || response.data.nextCursor),
      nextCursor: response.data.nextCursor
    };
  }

  async fetchDeliveredPackages(): Promise<Record<string, unknown>[]> {
    const credentials = await this.settings.getTrendyolConnection();
    const end = Date.now();
    const lookbackDays = credentials?.lookbackDays ?? envNumber("TRENDYOL_LOOKBACK_DAYS", 14);
    const start = end - lookbackDays * 24 * 60 * 60 * 1000;
    const packages: Record<string, unknown>[] = [];
    let nextCursor: string | undefined;
    let page = 0;

    do {
      const response = await this.fetchDeliveredPackagePage({ startDate: start, endDate: end, nextCursor });
      packages.push(...response.content);
      nextCursor = response.nextCursor;
      page += 1;

      if (page > 100) {
        this.logger.warn("Trendyol stream scan stopped after 100 cursor pages");
        break;
      }
    } while (nextCursor);

    return packages;
  }

  async sendInvoiceFile(input: {
    shipmentPackageId: string;
    invoiceNumber: string;
    invoiceDate: Date;
    pdfPath: string;
  }): Promise<{ ok: true; mode: "api"; alreadySent?: boolean; response?: unknown }> {
    const credentials = await this.settings.getTrendyolConnection();
    const sellerId = credentials?.sellerId ?? requiredEnv("TRENDYOL_SELLER_ID");
    const apiKey = credentials?.apiKey ?? requiredEnv("TRENDYOL_API_KEY");
    const apiSecret = credentials?.apiSecret ?? requiredEnv("TRENDYOL_API_SECRET");
    const baseUrl = credentials?.baseUrl ?? process.env.TRENDYOL_BASE_URL ?? "https://apigw.trendyol.com";

    const form = new FormData();
    form.append("shipmentPackageId", input.shipmentPackageId);
    form.append("invoiceDateTime", String(input.invoiceDate.getTime()));
    form.append("invoiceNumber", input.invoiceNumber);
    form.append("file", fs.createReadStream(input.pdfPath), {
      filename: `${input.invoiceNumber}.pdf`,
      contentType: "application/pdf"
    });

    const response = await axios.post(`${baseUrl}/integration/sellers/${sellerId}/seller-invoice-file`, form, {
      auth: { username: apiKey, password: apiSecret },
      headers: {
        ...form.getHeaders(),
        "User-Agent": credentials?.userAgent ?? process.env.TRENDYOL_USER_AGENT ?? `SAFA-${sellerId}`
      },
      maxBodyLength: 10 * 1024 * 1024,
      timeout: 30_000,
      validateStatus: () => true
    });

    if (response.status === 409) {
      return { ok: true, mode: "api", alreadySent: true, response: response.data };
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Trendyol fatura PDF yukleme HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 240)}`);
    }

    return { ok: true, mode: "api", response: response.data };
  }
}
