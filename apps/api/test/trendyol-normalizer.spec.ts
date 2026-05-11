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
    expect(normalized.deliveredAt?.toISOString()).toBe("2026-04-22T11:33:03.954Z");
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
});
