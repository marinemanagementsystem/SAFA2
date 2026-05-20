import { describe, expect, it } from "vitest";
import {
  buildHepsiburadaCatalogPayload,
  buildHepsiburadaListingPayload,
  extractHepsiburadaJobId,
  extractHepsiburadaTrackingId,
  normalizeHepsiburadaOrderLine
} from "../src/hepsiburada/hepsiburada-normalizer";

describe("hepsiburada normalizer", () => {
  it("builds a catalog file payload from SAFA products", () => {
    const payload = buildHepsiburadaCatalogPayload([
      {
        name: "SAFA Test Urun",
        barcode: "8680000000011",
        merchantSku: "SAFA-HB-1",
        brand: "SAFA",
        categoryName: "Online Lisanslar",
        vatRate: 20,
        priceCents: 19990,
        stock: 7,
        dispatchTime: 2,
        description: "Test katalog urunu"
      }
    ]);

    expect(payload.fileName).toBe("safa-hepsiburada-catalog.json");
    expect(payload.records).toEqual([
      {
        categoryName: "Online Lisanslar",
        merchant: "SAFA-HB-1",
        attributes: {
          Barcode: "8680000000011",
          Brand: "SAFA",
          ProductName: "SAFA Test Urun",
          Description: "Test katalog urunu",
          VatRate: 20,
          Price: 199.9,
          AvailableStock: 7,
          DispatchTime: 2
        }
      }
    ]);
    expect(JSON.parse(payload.buffer.toString("utf8"))).toEqual(payload.records);
  });

  it("builds listing price and stock payloads with HB and merchant sku identifiers", () => {
    const listing = {
      hbSku: "HBV000TEST",
      merchantSku: "SAFA-HB-1",
      productName: "SAFA Test Urun",
      priceCents: 19990,
      stock: 7,
      dispatchTime: 2
    };

    expect(buildHepsiburadaListingPayload([listing], "price")).toEqual([
      {
        HepsiburadaSku: "HBV000TEST",
        MerchantSku: "SAFA-HB-1",
        ProductName: "SAFA Test Urun",
        Price: 199.9,
        DispatchTime: 2
      }
    ]);
    expect(buildHepsiburadaListingPayload([listing], "stock")).toEqual([
      {
        HepsiburadaSku: "HBV000TEST",
        MerchantSku: "SAFA-HB-1",
        ProductName: "SAFA Test Urun",
        AvailableStock: 7,
        DispatchTime: 2
      }
    ]);
  });

  it("extracts tracking and upload ids from Hepsiburada response variants", () => {
    expect(extractHepsiburadaTrackingId({ trackingId: "track-1" })).toBe("track-1");
    expect(extractHepsiburadaTrackingId({ data: { trackingID: "track-2" } })).toBe("track-2");
    expect(extractHepsiburadaJobId({ id: "job-1" })).toBe("job-1");
    expect(extractHepsiburadaJobId({ Id: "job-2" })).toBe("job-2");
  });

  it("normalizes a paid Hepsiburada line item into the shared invoice order shape", () => {
    const normalized = normalizeHepsiburadaOrderLine(
      {
        id: "line-1",
        sku: "HBV000TEST",
        merchantSku: "SAFA-HB-1",
        name: "SAFA Test Urun",
        orderNumber: "HB-1001",
        orderDate: "2026-05-20T09:00:00",
        customerName: "Sarper Test",
        quantity: 2,
        unitPrice: { amount: 100, currency: "TRY" },
        totalPrice: { amount: 200, currency: "TRY" },
        vatRate: 20,
        invoice: {
          turkishIdentityNumber: "12345678901",
          taxOffice: "Kadikoy",
          address: {
            name: "Sarper Test",
            address: "Adres satiri",
            district: "Moda",
            town: "Kadikoy",
            city: "Istanbul",
            countryCode: "TR",
            email: "sarper@example.com"
          }
        }
      },
      "PKG-1001"
    );

    expect(normalized).toMatchObject({
      shipmentPackageId: "HB-PKG-1001",
      orderNumber: "HB-1001",
      status: "PACKAGED",
      customerName: "Sarper Test",
      customerEmail: "sarper@example.com",
      customerIdentifier: "12345678901",
      totalGrossCents: 20000,
      totalPayableCents: 20000,
      currency: "TRY",
      invoiceAddress: {
        fullName: "Sarper Test",
        addressLine: "Adres satiri",
        district: "Kadikoy",
        city: "Istanbul",
        countryCode: "TR",
        taxOffice: "Kadikoy"
      }
    });
    expect(normalized.lines[0]).toMatchObject({
      sku: "SAFA-HB-1",
      barcode: "HBV000TEST",
      productName: "SAFA Test Urun",
      quantity: 2,
      unitPriceCents: 10000,
      grossCents: 20000,
      payableCents: 20000,
      vatRate: 20
    });
  });
});
