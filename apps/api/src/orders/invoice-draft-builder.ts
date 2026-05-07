import { NormalizedOrder } from "../trendyol/trendyol-normalizer";

export interface DraftValidation {
  errors: string[];
  warnings: string[];
}

export interface DraftLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  payableCents: number;
  vatRate: number;
}

export function buildDraft(order: NormalizedOrder): {
  lines: DraftLine[];
  totals: Record<string, unknown>;
  validation: DraftValidation;
  status: "READY" | "NEEDS_REVIEW";
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!order.shipmentPackageId) errors.push("Trendyol shipmentPackageId eksik.");
  if (!order.orderNumber) errors.push("Trendyol orderNumber eksik.");
  if (!order.customerName) errors.push("Alici adi eksik.");
  if (!order.invoiceAddress.addressLine) errors.push("Fatura adresi eksik.");
  if (!order.invoiceAddress.city) errors.push("Il bilgisi eksik.");
  if (!order.invoiceAddress.district) warnings.push("Ilce bilgisi eksik; GIB entegrasyonu reddederse manuel tamamlanmali.");
  if (!order.customerIdentifier) warnings.push("TCKN/VKN gelmedi; nihai tuketici varsayimiyla 11111111111 kullanilacak.");
  if (order.lines.length === 0) errors.push("Urun satiri yok.");

  const lines = order.lines.map((line) => {
    if (!line.productName) errors.push("Urun adi eksik.");
    if (line.quantity <= 0) errors.push(`${line.productName || "Urun"} icin miktar gecersiz.`);
    if (line.payableCents <= 0) errors.push(`${line.productName || "Urun"} icin tutar gecersiz.`);
    if (![0, 1, 8, 10, 18, 20].includes(line.vatRate)) {
      warnings.push(`${line.productName} icin KDV orani ${line.vatRate}; muhasebe kontrolu onerilir.`);
    }

    return {
      description: line.productName,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      grossCents: line.grossCents,
      discountCents: line.discountCents,
      payableCents: line.payableCents,
      vatRate: line.vatRate
    };
  });

  const linePayable = lines.reduce((sum, line) => sum + line.payableCents, 0);
  if (Math.abs(linePayable - order.totalPayableCents) > 2) {
    warnings.push("Satir toplamlari Trendyol toplamiyla tam eslesmiyor; indirim/kargo kurali kontrol edilmeli.");
  }

  return {
    lines,
    totals: {
      grossCents: order.totalGrossCents,
      discountCents: order.totalDiscountCents,
      payableCents: order.totalPayableCents,
      currency: order.currency,
      buyerIdentifier: order.customerIdentifier ?? "11111111111"
    },
    validation: { errors, warnings },
    status: errors.length > 0 ? "NEEDS_REVIEW" : "READY"
  };
}
