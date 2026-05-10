export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function money(cents: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency
  }).format(cents / 100);
}

export function formatDateTime(value?: string) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function dateMatches(value: string | undefined, filter: "all" | "today" | "last7" | "last30") {
  if (filter === "all") return true;
  if (!value) return false;

  const date = new Date(value);
  const today = startOfToday();

  if (filter === "today") return date >= today;

  const days = filter === "last7" ? 7 : 30;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  return date >= threshold;
}

export function stringValue(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("tr-TR");
}

export function numberValue(value: unknown) {
  if (value === undefined || value === null || value === "") return Number.NEGATIVE_INFINITY;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

export function lineNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function statusTone(status?: string) {
  if (!status) return "neutral";
  if (["READY", "APPROVED", "ISSUED", "TRENDYOL_SENT", "SUCCESS", "SENT"].includes(status)) return "success";
  if (["PENDING", "PROCESSING", "ISSUING", "NEEDS_REVIEW", "PORTAL_DRAFTED"].includes(status)) return "warning";
  if (["ERROR", "FAILED", "TRENDYOL_SEND_FAILED", "SEND_FAILED"].includes(status)) return "danger";
  return "neutral";
}

export function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    READY: "Hazir",
    APPROVED: "Onayli",
    ISSUED: "Kesildi",
    TRENDYOL_SENT: "Trendyol'a gitti",
    PORTAL_DRAFTED: "Portal imza bekliyor",
    SUCCESS: "Basarili",
    SENT: "Gonderildi",
    PENDING: "Bekliyor",
    PROCESSING: "Isleniyor",
    ISSUING: "Fatura kesiliyor",
    NEEDS_REVIEW: "Kontrol gerekli",
    ERROR: "Hata",
    FAILED: "Basarisiz",
    TRENDYOL_SEND_FAILED: "Trendyol hata",
    SEND_FAILED: "Gonderim hata"
  };

  if (!status) return "Yok";
  return labels[status] ?? status;
}
