import { describe, expect, it } from "vitest";
import { buildGibEArchiveQrPayload, buildInvoiceHtmlForTest } from "../src/invoice/pdf/simple-invoice-pdf";
import type { ArchiveInvoicePayload } from "../src/invoice/invoice-provider";

const payload: ArchiveInvoicePayload = {
  orderNumber: "11227170653",
  shipmentPackageId: "pkg-1",
  buyerName: "Sarper Test",
  buyerIdentifier: "12345678901",
  buyerType: "person",
  address: {
    addressLine: "Adres",
    district: "Kadikoy",
    city: "Istanbul",
    countryCode: "TR"
  },
  lines: [
    {
      description: "Urun",
      quantity: 1,
      unitPriceCents: 38336,
      grossCents: 38336,
      discountCents: 0,
      payableCents: 38336,
      vatRate: 20
    }
  ],
  totals: {
    grossCents: 38336,
    discountCents: 0,
    payableCents: 38336,
    currency: "TRY"
  }
};

describe("simple invoice PDF reconstruction metadata", () => {
  it("uses externally supplied signed invoice identifiers in the rendered invoice HTML", () => {
    const html = buildInvoiceHtmlForTest(payload, {
      title: "e-Arsiv Fatura",
      documentNumber: "GIB202600007",
      documentDate: new Date("2026-05-24T09:00:00.000Z"),
      ettn: "77777777-7777-4777-8777-777777777777",
      qrPayload: "signed-gib-qr-payload"
    });

    expect(html).toContain("GIB202600007");
    expect(html).toContain("77777777-7777-4777-8777-777777777777");
    expect(html).toContain("file:///SAFA/77777777-7777-4777-8777-777777777777_GIB202600007.html");
    expect(html).not.toContain("TASLAK-11227170653");
  });

  it("builds a GIB e-Archive QR payload from signed invoice fields and totals", () => {
    const qrPayload = buildGibEArchiveQrPayload(payload, {
      documentNumber: "GIB202600007",
      documentDate: new Date("2026-05-24T09:00:00.000Z"),
      ettn: "77777777-7777-4777-8777-777777777777"
    });

    expect(qrPayload).toContain('"senaryo":"EARSIVFATURA"');
    expect(qrPayload).toContain('"tip":"SATIS"');
    expect(qrPayload).toContain('"no":"GIB202600007"');
    expect(qrPayload).toContain('"ettn":"77777777-7777-4777-8777-777777777777"');
    expect(qrPayload).toContain('"avkntckn":"12345678901"');
    expect(qrPayload).toContain('"odenecek":"383.36"');
  });
});
