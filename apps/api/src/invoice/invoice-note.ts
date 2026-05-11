import type { ArchiveInvoicePayload } from "./invoice-provider";

const ones = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const tens = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

function wordsBelowThousand(value: number) {
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const ten = Math.floor(rest / 10);
  const one = rest % 10;
  return `${hundred > 1 ? ones[hundred] : ""}${hundred ? "yüz" : ""}${tens[ten]}${ones[one]}`;
}

function integerWords(value: number): string {
  if (value === 0) return "sıfır";

  const scales = [
    { value: 1_000_000_000, label: "milyar" },
    { value: 1_000_000, label: "milyon" },
    { value: 1000, label: "bin" }
  ];
  const parts: string[] = [];
  let remaining = value;

  for (const scale of scales) {
    const count = Math.floor(remaining / scale.value);
    if (count > 0) {
      parts.push(`${scale.value === 1000 && count === 1 ? "" : integerWords(count)}${scale.label}`);
      remaining %= scale.value;
    }
  }

  if (remaining > 0) parts.push(wordsBelowThousand(remaining));
  return parts.join("");
}

export function payableAmountInTurkishWords(cents: number) {
  const safeCents = Math.max(0, Math.round(cents));
  const lira = Math.floor(safeCents / 100);
  const kurus = safeCents % 100;
  return `${integerWords(lira)}türklirası${integerWords(kurus)}kuruş.`;
}

export function invoiceNote(payload: ArchiveInvoicePayload) {
  return `${payableAmountInTurkishWords(payload.totals.payableCents)} Trendyol siparis no: ${payload.orderNumber} / Paket: ${payload.shipmentPackageId}`;
}
