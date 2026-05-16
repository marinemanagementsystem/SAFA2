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
      birimFiyat: "100.00",
      fiyat: "200.00",
      malHizmetTutari: "200.00",
      kdvTutari: "40.00"
    });
  });

  it("keeps GIB-calculated VAT totals consistent with the payable amount when Trendyol has hidden discounts", () => {
    const draft = buildGibPortalInvoiceDraftPayload(
      {
        ...payload,
        lines: [
          {
            description: "Trendyol urunu",
            quantity: 1,
            unitPriceCents: 22744,
            grossCents: 22744,
            discountCents: 2366,
            payableCents: 20378,
            vatRate: 20
          }
        ],
        totals: {
          grossCents: 22744,
          discountCents: 2366,
          payableCents: 18012,
          currency: "TRY"
        }
      },
      { uuid: "7a4a02f7-1dfb-4686-aefc-f86494a99f73" }
    );

    expect(draft.malhizmetToplamTutari).toBe("189.53");
    expect(draft.toplamIskonto).toBe("39.43");
    expect(draft.hesaplanankdv).toBe("30.02");
    expect(draft.vergilerDahilToplamTutar).toBe("180.12");
    expect(draft.odenecekTutar).toBe("180.12");
    expect(draft.malHizmetTable[0]).toMatchObject({
      fiyat: "189.53",
      iskontoTutari: "39.43",
      malHizmetTutari: "150.10",
      kdvTutari: "30.02"
    });
  });

  it("matches the GIB portal discount and VAT equation for the accepted sample totals", () => {
    const draft = buildGibPortalInvoiceDraftPayload(
      {
        ...payload,
        lines: [
          {
            description: "Trendyol urunu",
            quantity: 1,
            unitPriceCents: 48554,
            grossCents: 48554,
            discountCents: 10218,
            payableCents: 38336,
            vatRate: 20
          }
        ],
        totals: {
          grossCents: 48554,
          discountCents: 10218,
          payableCents: 38336,
          currency: "TRY"
        }
      },
      { uuid: "a19a9a82-bf80-4955-b0d7-7c4f44a2f719" }
    );

    expect(draft.malhizmetToplamTutari).toBe("404.62");
    expect(draft.toplamIskonto).toBe("85.15");
    expect(draft.hesaplanankdv).toBe("63.89");
    expect(draft.vergilerDahilToplamTutar).toBe("383.36");
    expect(draft.odenecekTutar).toBe("383.36");
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
