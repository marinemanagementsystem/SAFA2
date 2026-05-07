export function toCents(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  if (typeof value === "string") {
    const normalized = value
      .trim()
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }

  return 0;
}

export function centsToDecimal(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatTry(cents: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY"
  }).format(centsToDecimal(cents));
}
