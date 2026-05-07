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
      lines: [{ productName: "Urun", quantity: 2, amount: 120, discount: 20, vatBaseAmount: 20 }]
    });

    expect(normalized.shipmentPackageId).toBe("42");
    expect(normalized.customerName).toBe("Ali Kaya");
    expect(normalized.totalPayableCents).toBe(10000);
    expect(normalized.lines[0]?.quantity).toBe(2);
  });
});
