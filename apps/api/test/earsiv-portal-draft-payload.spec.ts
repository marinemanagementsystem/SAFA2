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
      faturaUuid: "3b4c1c45-9c7d-4c3c-8cc1-cb9f5b4a09a1",
      faturaTarihi: "10/05/2026",
      saat: "12:34:56",
      faturaTipi: "SATIS",
      hangiTip: "5000/30000",
      vknTckn: "11111111111",
      aliciAdi: "Mahmut Ege",
      aliciSoyadi: "Cam",
      sehir: "Izmir",
      mahalleSemtIlce: "Konak",
      bulvarcaddesokak: "Test Mahallesi Test Sokak No 1",
      siparisNumarasi: "11190835272",
      matrah: "100.00",
      hesaplanankdv: "20.00",
      odenecekTutar: "120.00",
      not: "yüzyirmitürklirasısıfırkuruş. Trendyol siparis no: 11190835272 / Paket: 3809481475",
      dovzTLkur: "0",
      vergiCesidi: " "
    });
    expect(draft.malHizmetTable).toHaveLength(1);
    expect(draft.malHizmetTable[0]).toMatchObject({
      malHizmet: "Trendyol urunu",
      birim: "C62",
      birimFiyat: "100.00",
      fiyat: "100.00",
      malHizmetTutari: "100.00",
      kdvOrani: "20",
      kdvTutari: "20.00",
      vergiOrani: 0,
      vergininKdvTutari: "0.00"
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

  it("keeps payable portal totals equal to the invoice payload total for quantity-based orders", () => {
    const draft = buildGibPortalInvoiceDraftPayload(
      {
        ...payload,
        lines: [
          {
            description: "Trendyol urunu",
            quantity: 2,
            unitPriceCents: 6000,
            grossCents: 12000,
            discountCents: 0,
            payableCents: 12000,
            vatRate: 20
          }
        ],
        totals: {
          grossCents: 24000,
          discountCents: 0,
          payableCents: 24000,
          currency: "TRY"
        }
      },
      { uuid: "0ed1d89b-3d5f-4d5d-97e6-0e5a5f9ec051" }
    );

    expect(draft.vergilerDahilToplamTutar).toBe("240.00");
    expect(draft.odenecekTutar).toBe("240.00");
    expect(draft.not).toBe("ikiyüzkırktürklirasısıfırkuruş. Trendyol siparis no: 11190835272 / Paket: 3809481475");
    expect(draft.malHizmetTable[0]).toMatchObject({
      miktar: 2,
      birimFiyat: "50.00",
      fiyat: "100.00",
      malHizmetTutari: "100.00"
    });
  });

  it("normalizes ETTN before sending it to the GIB portal", () => {
    const draft = buildGibPortalInvoiceDraftPayload(payload, {
      uuid: "{6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53}"
    });

    expect(draft.faturaUuid).toBe("6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53");
    expect(draft.faturaUuid).toHaveLength(36);
  });

  it("rejects invalid ETTN values before calling the GIB portal", () => {
    expect(() => buildGibPortalInvoiceDraftPayload(payload, { uuid: "bad-ettn" })).toThrow(
      "GIB portal ETTN 36 karakterlik UUID formatinda olmali."
    );
  });
});
