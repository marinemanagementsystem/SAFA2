import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import { TrendyolService } from "../src/trendyol/trendyol.service";

vi.mock("axios", () => ({
  default: {
    post: vi.fn()
  }
}));

const post = vi.mocked(axios.post);

describe("TrendyolService", () => {
  it("treats duplicate invoice uploads as already sent", async () => {
    post.mockResolvedValueOnce({ status: 409, data: { message: "invoice already exists" } });

    const service = new TrendyolService({
      getTrendyolConnection: vi.fn(async () => ({
        sellerId: "seller",
        apiKey: "key",
        apiSecret: "secret",
        baseUrl: "https://apigw.trendyol.com",
        storefrontCode: "TR",
        lookbackDays: 14,
        userAgent: "SAFA test"
      }))
    } as any);

    const result = await service.sendInvoiceFile({
      shipmentPackageId: "package-1",
      invoiceNumber: "GIB2026001",
      invoiceDate: new Date("2026-05-15T00:00:00.000Z"),
      pdfPath: __filename
    });

    expect(result).toMatchObject({
      ok: true,
      alreadySent: true
    });
  });
});
