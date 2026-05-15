import { describe, expect, it } from "vitest";
import { normalizeTrendyolPackage } from "../src/trendyol/trendyol-normalizer";

describe("normalizeTrendyolPackage", () => {
  it("creates a stable internal order shape", () => {
    const normalized = normalizeTrendyolPackage({
      shipmentPackageId: 42,
      orderNumber: "TY-42",
      shipmentPackageStatus: "Delivered",
      customerFirstName: "Ali",
      customerLastName: "Kaya",
      invoiceAddress: { address1: "Adres", district: "Besiktas", city: "Istanbul" },
      grossAmount: 120,
      totalDiscount: 20,
      totalPrice: 100,
      packageHistories: [
        { status: "Created", createdDate: 1776426328470 },
        { status: "Delivered", createdDate: 1776857583954 }
      ],
      lines: [{ productName: "Urun", quantity: 2, amount: 120, discount: 20, vatBaseAmount: 20 }]
    });

    expect(normalized.shipmentPackageId).toBe("42");
    expect(normalized.customerName).toBe("Ali Kaya");
    expect(normalized.totalPayableCents).toBe(10000);
    expect(normalized.lines[0]?.quantity).toBe(2);
    expect(normalized.lines[0]?.grossCents).toBe(12000);
    expect(normalized.lines[0]?.payableCents).toBe(10000);
    expect(normalized.lines[0]?.unitPriceCents).toBe(6000);
    expect(normalized.deliveredAt?.toISOString()).toBe("2026-04-22T11:33:03.954Z");
  });

  it("treats ambiguous line amounts as unit prices when quantity and package totals require it", () => {
    const normalized = normalizeTrendyolPackage({
      shipmentPackageId: 45,
      orderNumber: "TY-45",
      shipmentPackageStatus: "Delivered",
      customerFirstName: "Ali",
      customerLastName: "Kaya",
      invoiceAddress: { address1: "Adres", district: "Besiktas", city: "Istanbul" },
      grossAmount: 240,
      totalPrice: 240,
      lines: [{ productName: "Urun", quantity: 2, amount: 120, vatBaseAmount: 20 }]
    });

    expect(normalized.totalPayableCents).toBe(24000);
    expect(normalized.lines[0]).toMatchObject({
      quantity: 2,
      grossCents: 24000,
      payableCents: 24000,
      unitPriceCents: 12000
    });
  });

  it("rebuilds the Trendyol invoice popup address as the invoice address line", () => {
    const popupAddress =
      "Başkaya mahallesi inci Sokak no 10 Şenoba beldesi Uludere Şırnak Başkaya Mah (Şenoba Köyü) Uludere/Şırnak Türkiye 73000";
    const normalized = normalizeTrendyolPackage({
      shipmentPackageId: 43,
      orderNumber: "TY-43",
      shipmentPackageStatus: "Delivered",
      customerFirstName: "Tuncay",
      customerLastName: "Balyemez",
      invoiceAddress: {
        address1: "Başkaya mahallesi inci Sokak no 10 Şenoba beldesi Uludere Şırnak",
        fullAddress: "Başkaya mahallesi inci Sokak no 10 Şenoba beldesi Uludere Şırnak     Uludere Şırnak",
        neighborhood: "Başkaya Mah (Şenoba Köyü)",
        district: "Uludere",
        city: "Şırnak",
        countryCode: "TR",
        postalCode: "73000"
      },
      grossAmount: 100,
      totalPrice: 100,
      lines: [{ productName: "Urun", quantity: 1, amount: 100, vatBaseAmount: 20 }]
    });

    expect(normalized.invoiceAddress.addressLine).toBe(popupAddress);
  });

  it("uses invoice address even when delivery address is different", () => {
    const normalized = normalizeTrendyolPackage({
      shipmentPackageId: 44,
      orderNumber: "TY-44",
      shipmentPackageStatus: "Delivered",
      customerFirstName: "Ayse",
      customerLastName: "Yilmaz",
      shipmentAddress: {
        fullName: "Ayse Yilmaz",
        address1: "Teslimat Mahallesi Teslimat Sokak No 5",
        district: "Kadikoy",
        city: "Istanbul"
      },
      deliveryAddress: {
        fullName: "Ayse Yilmaz",
        address1: "Teslimat Mahallesi Teslimat Sokak No 5",
        district: "Kadikoy",
        city: "Istanbul"
      },
      invoiceAddress: {
        fullName: "Ayse Yilmaz",
        address1: "Fatura Mahallesi Fatura Caddesi No 10",
        district: "Cankaya",
        city: "Ankara",
        countryCode: "TR",
        postalCode: "06000"
      },
      grossAmount: 199.9,
      totalPrice: 199.9,
      lines: [{ productName: "Urun", quantity: 1, amount: 199.9, vatBaseAmount: 20 }]
    });

    expect(normalized.invoiceAddress.addressLine).toBe("Fatura Mahallesi Fatura Caddesi No 10 Cankaya/Ankara Türkiye 06000");
    expect(normalized.invoiceAddress.addressLine).not.toContain("Teslimat Mahallesi");
  });
});
