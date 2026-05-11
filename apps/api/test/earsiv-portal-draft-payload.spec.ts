import { describe, expect, it } from "vitest";
import { buildGibPortalInvoiceDraftPayload } from "../src/earsiv-portal/portal-draft-payload";
import type { ArchiveInvoicePayload } from "../src/invoice/invoice-provider";

const payload: ArchiveInvoicePayload = {
  orderNumber: "11190835272",
  shipmentPackageId: "3809481475",
  buyerName: "Mahmut Ege Cam",
  buyerIdentifier: "11111111111",
  address: {
    addressLine: "Test Mahallesi Test Sokak No 1",
    district: "Konak",
    city: "Izmir",
    countryCode: "TR"
  },
  lines: [
    {
      description: "Trendyol urunu",
      quantity: 1,
      unitPriceCents: 12000,
      grossCents: 12000,
      discountCents: 0,
      payableCents: 12000,
      vatRate: 20
    }
  ],
  totals: {
    grossCents: 12000,
    discountCents: 0,
    payableCents: 12000,
    currency: "TRY"
  }
};

describe("buildGibPortalInvoiceDraftPayload", () => {
  it("maps a Trendyol draft to the GIB portal draft command payload", () => {
    const draft = buildGibPortalInvoiceDraftPayload(payload, {
      uuid: "3b4c1c45-9c7d-4c3c-8cc1-cb9f5b4a09a1",
      issuedAt: new Date("2026-05-10T12:34:56"),
      unitCode: "C62"
    });

    expect(draft).toMatchObject({
      faturaUuid: "3B4C1C45-9C7D-4C3C-8CC1-CB9F5B4A09A1",
      faturaTarihi: "10/05/2026",
      saat: "12:34:56",
      faturaTipi: "SATIS",
      hangiTip: "5000/30000",
      vknTckn: "11111111111",
      aliciAdi: "Mahmut Ege",
      aliciSoyadi: "Cam",
      sehir: "Izmir",
      mahalleSemtIlce: "Konak",
      siparisNumarasi: "11190835272",
      matrah: 100,
      hesaplanankdv: 20,
      odenecekTutar: 120
    });
    expect(draft.malHizmetTable).toHaveLength(1);
    expect(draft.malHizmetTable[0]).toMatchObject({
      malHizmet: "Trendyol urunu",
      birim: "C62",
      birimFiyat: 100,
      fiyat: 100,
      malHizmetTutari: 100,
      kdvOrani: 20,
      kdvTutari: 20
    });
  });

  it("uses buyer title for VKN recipients", () => {
    const draft = buildGibPortalInvoiceDraftPayload(
      {
        ...payload,
        buyerName: "SAFA TICARET LIMITED SIRKETI",
        buyerIdentifier: "1234567890"
      },
      { uuid: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53" }
    );

    expect(draft.aliciUnvan).toBe("SAFA TICARET LIMITED SIRKETI");
    expect(draft.aliciAdi).toBe("");
    expect(draft.aliciSoyadi).toBe("");
  });

  it("normalizes ETTN before sending it to the GIB portal", () => {
    const draft = buildGibPortalInvoiceDraftPayload(payload, {
      uuid: "{6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53}"
    });

    expect(draft.faturaUuid).toBe("6F0FDC0F-D6A7-4D1A-B4DD-EA1FD9D2DA53");
    expect(draft.faturaUuid).toHaveLength(36);
  });

  it("rejects invalid ETTN values before calling the GIB portal", () => {
    expect(() => buildGibPortalInvoiceDraftPayload(payload, { uuid: "bad-ettn" })).toThrow(
      "GIB portal ETTN 36 karakterlik UUID formatinda olmali."
    );
  });
});
