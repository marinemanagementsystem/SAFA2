import { Inject, Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import { envBool, envNumber, requiredEnv } from "../common/env";
import { SettingsService } from "../settings/settings.service";
import { sampleTrendyolPackages } from "./sample-orders";

interface StreamResponse {
  content?: Record<string, unknown>[];
  hasMore?: boolean;
  nextCursor?: string;
}

@Injectable()
export class TrendyolService {
  private readonly logger = new Logger(TrendyolService.name);

  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async fetchDeliveredPackages(): Promise<Record<string, unknown>[]> {
    const credentials = await this.settings.getTrendyolConnection();

    if (!credentials && envBool("USE_MOCK_INTEGRATIONS", true)) {
      return sampleTrendyolPackages;
    }

    if (!credentials) {
      requiredEnv("TRENDYOL_SELLER_ID");
    }

    const sellerId = credentials?.sellerId ?? requiredEnv("TRENDYOL_SELLER_ID");
    const apiKey = credentials?.apiKey ?? requiredEnv("TRENDYOL_API_KEY");
    const apiSecret = credentials?.apiSecret ?? requiredEnv("TRENDYOL_API_SECRET");
    const baseUrl = credentials?.baseUrl ?? process.env.TRENDYOL_BASE_URL ?? "https://apigw.trendyol.com";
    const storeFrontCode = credentials?.storefrontCode ?? process.env.TRENDYOL_STOREFRONT_CODE ?? "TR";
    const lookbackDays = credentials?.lookbackDays ?? envNumber("TRENDYOL_LOOKBACK_DAYS", 14);
    const end = Date.now();
    const start = end - lookbackDays * 24 * 60 * 60 * 1000;
    const packages: Record<string, unknown>[] = [];
    let nextCursor: string | undefined;
    let page = 0;

    do {
      const response = await axios.get<StreamResponse>(`${baseUrl}/integration/order/sellers/${sellerId}/orders/stream`, {
        auth: { username: apiKey, password: apiSecret },
        headers: {
          "User-Agent": credentials?.userAgent ?? process.env.TRENDYOL_USER_AGENT ?? `SAFA-${sellerId}`,
          storeFrontCode
        },
        params: {
          size: 200,
          packageItemStatuses: "Delivered",
          lastModifiedStartDate: start,
          lastModifiedEndDate: end,
          ...(nextCursor ? { nextCursor } : {})
        },
        timeout: 30_000
      });

      packages.push(...(response.data.content ?? []));
      nextCursor = response.data.nextCursor;
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
  }): Promise<{ ok: true; mode: "mock" | "api"; response?: unknown }> {
    if (envBool("USE_MOCK_INTEGRATIONS", true)) {
      return { ok: true, mode: "mock", response: { message: "Mock Trendyol upload accepted" } };
    }

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
      timeout: 30_000
    });

    return { ok: true, mode: "api", response: response.data };
  }
}
