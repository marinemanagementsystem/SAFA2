import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { GibDirectInvoiceProvider } from "../src/invoice/providers/gib-direct-invoice.provider";
import { buildGibDraftInvoiceXml } from "../src/invoice/ubl/gib-draft-invoice-xml";
import type { SettingsService } from "../src/settings/settings.service";

const payload = {
  orderNumber: "TY-1",
  shipmentPackageId: "PKG-1",
  buyerName: "Test Alici",
  buyerIdentifier: "11111111111",
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
      unitPriceCents: 10000,
      grossCents: 10000,
      discountCents: 0,
      payableCents: 10000,
      vatRate: 20
    }
  ],
  totals: {
    grossCents: 10000,
    discountCents: 0,
    payableCents: 10000,
    currency: "TRY"
  }
};

describe("GibDirectInvoiceProvider", () => {
  it("fails closed when GIB direct configuration is missing", async () => {
    const settings = {
      getGibDirectConnection: async () => undefined,
      gibDirectReadiness: async () => ({
        configured: false,
        ready: false,
        mode: "test",
        signerMode: "external-command",
        source: "none",
        missing: ["GIB servis URL"],
        message: "GIB direct ayarlari henuz tanimli degil."
      })
    } satisfies Partial<SettingsService>;
    const provider = new GibDirectInvoiceProvider(settings as SettingsService);

    await expect(provider.issueArchiveInvoice(payload)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("buildGibDraftInvoiceXml", () => {
  it("creates an e-Arsiv UBL draft with order metadata", () => {
    const xml = buildGibDraftInvoiceXml(payload, {
      invoiceId: "SAF2026000000001",
      sellerTaxId: "1191883",
      defaultBuyerTckn: "11111111111"
    });

    expect(xml).toContain("<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>");
    expect(xml).toContain("<cbc:ID>SAF2026000000001</cbc:ID>");
    expect(xml).toContain("<cbc:ID schemeID=\"VKN\">1191883</cbc:ID>");
    expect(xml).toContain("yüztürklirasısıfırkuruş.");
    expect(xml).toContain("Trendyol siparis no: TY-1 / Paket: PKG-1");
    expect(xml).toContain("<cbc:Name>Test Alici</cbc:Name>");
    expect(xml).toContain("<cbc:StreetName>Adres</cbc:StreetName>");
  });
});
