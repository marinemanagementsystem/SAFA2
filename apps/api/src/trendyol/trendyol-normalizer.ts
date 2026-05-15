import { toCents } from "../common/money";

type UnknownRecord = Record<string, unknown>;

export interface NormalizedInvoiceAddress {
  fullName: string;
  addressLine: string;
  district: string;
  city: string;
  countryCode: string;
  taxOffice?: string;
}

export interface NormalizedLine {
  sku?: string;
  barcode?: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  payableCents: number;
  vatRate: number;
}

export interface NormalizedOrder {
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string;
  customerIdentifier?: string;
  invoiceAddress: NormalizedInvoiceAddress;
  lines: NormalizedLine[];
  totalGrossCents: number;
  totalDiscountCents: number;
  totalPayableCents: number;
  currency: string;
  lastModifiedAt?: Date;
  deliveredAt?: Date;
  raw: UnknownRecord;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function timestampToDate(value: unknown): Date | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function dateFromUnknown(value: unknown): Date | undefined {
  if (typeof value === "number") return timestampToDate(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return timestampToDate(numeric);
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function countryName(value: unknown) {
  const code = firstText(value);
  if (!code) return "";
  return code.toLocaleUpperCase("tr-TR") === "TR" ? "Türkiye" : code;
}

function invoiceAddressLine(invoiceAddress: UnknownRecord) {
  const addressParts = [invoiceAddress.address1, invoiceAddress.address2].map(text).filter(Boolean);
  const base = addressParts.length > 0 ? addressParts.join(" ") : firstText(invoiceAddress.fullAddress, invoiceAddress.address);
  const district = firstText(invoiceAddress.district, invoiceAddress.town, invoiceAddress.countyName);
  const city = firstText(invoiceAddress.city, invoiceAddress.province);
  const districtCity = district && city ? `${district}/${city}` : firstText(district, city);

  return [
    base,
    firstText(invoiceAddress.neighborhood, invoiceAddress.neighbourhood),
    districtCity,
    countryName(invoiceAddress.countryCode),
    firstText(invoiceAddress.postalCode, invoiceAddress.zipCode, invoiceAddress.zip)
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

type LineAmountStrategy = "line-total" | "unit-price";
type LineAmountSource = "amount" | "price" | "totalPrice";

const lineAmountSources: LineAmountSource[] = ["amount", "price", "totalPrice"];

function moneyCents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return toCents(value);
}

function hasMoneyValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function lineAmountCents(line: UnknownRecord, source?: LineAmountSource) {
  return toCents(source ? line[source] : (line.amount ?? line.price ?? line.totalPrice));
}

function normalizeLines(lines: UnknownRecord[], strategy: LineAmountStrategy, source?: LineAmountSource): NormalizedLine[] {
  return lines.map((line) => {
    const quantity = Math.max(1, numberValue(line.quantity, 1));
    const sourceCents = lineAmountCents(line, source);
    const grossCents = strategy === "unit-price" ? sourceCents * quantity : sourceCents;
    const discountCents = toCents(line.discount ?? line.totalDiscount ?? 0);
    const payableCents = Math.max(0, grossCents - discountCents);
    const unitPriceCents = grossCents > 0 ? Math.round(grossCents / quantity) : toCents(line.price);

    return {
      sku: firstText(line.merchantSku, line.sku),
      barcode: firstText(line.barcode),
      productName: firstText(line.productName, line.name, line.productCode, "Urun"),
      quantity,
      unitPriceCents,
      grossCents,
      discountCents,
      payableCents,
      vatRate: numberValue(line.vatBaseAmount, 20)
    };
  });
}

function scoreLines(
  lines: NormalizedLine[],
  expected: {
    grossCents?: number;
    discountCents?: number;
    payableCents?: number;
  }
) {
  const lineGross = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const lineDiscount = lines.reduce((sum, line) => sum + line.discountCents, 0);
  const linePayable = lines.reduce((sum, line) => sum + line.payableCents, 0);
  let score = 0;

  if (expected.grossCents !== undefined) score += Math.abs(lineGross - expected.grossCents);
  if (expected.discountCents !== undefined) score += Math.abs(lineDiscount - expected.discountCents);
  if (expected.payableCents !== undefined) score += Math.abs(linePayable - expected.payableCents);

  return score;
}

function normalizeLinesByPackageTotals(lines: UnknownRecord[], pkg: UnknownRecord) {
  const expected = {
    grossCents: moneyCents(pkg.grossAmount),
    discountCents: moneyCents(pkg.totalDiscount),
    payableCents: moneyCents(pkg.totalPrice)
  };
  const candidates = [
    normalizeLines(lines, "line-total"),
    normalizeLines(lines, "unit-price"),
    ...lineAmountSources
      .filter((source) => lines.some((line) => hasMoneyValue(line[source])))
      .flatMap((source) => [normalizeLines(lines, "line-total", source), normalizeLines(lines, "unit-price", source)])
  ];

  return candidates
    .map((candidate) => ({ lines: candidate, score: scoreLines(candidate, expected) }))
    .reduce((best, candidate) => (candidate.score < best.score ? candidate : best)).lines;
}

export function extractTrendyolDeliveryDate(raw: unknown): Date | undefined {
  const pkg = record(raw);

  for (const key of ["deliveredAt", "deliveredDate", "deliveryDate", "teslimTarihi"]) {
    const direct = dateFromUnknown(pkg[key]);
    if (direct) return direct;
  }

  const histories = Array.isArray(pkg.packageHistories) ? (pkg.packageHistories as UnknownRecord[]) : [];
  const deliveredHistory = histories
    .map((history) => {
      const status = firstText(history.status).toLocaleLowerCase("tr-TR");
      if (status !== "delivered" && !status.includes("teslim")) return undefined;
      return dateFromUnknown(history.createdDate ?? history.date ?? history.createdAt);
    })
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return deliveredHistory;
}

export function normalizeTrendyolPackage(pkg: UnknownRecord): NormalizedOrder {
  const invoiceAddress = record(pkg.invoiceAddress);
  const lines = Array.isArray(pkg.lines) ? (pkg.lines as UnknownRecord[]) : [];
  const firstName = firstText(invoiceAddress.firstName, pkg.customerFirstName);
  const lastName = firstText(invoiceAddress.lastName, pkg.customerLastName);
  const fullName = firstText(invoiceAddress.fullName, `${firstName} ${lastName}`.trim(), pkg.customerName);

  const normalizedLines = normalizeLinesByPackageTotals(lines, pkg);

  const lineGross = normalizedLines.reduce((sum, line) => sum + line.grossCents, 0);
  const lineDiscount = normalizedLines.reduce((sum, line) => sum + line.discountCents, 0);
  const linePayable = normalizedLines.reduce((sum, line) => sum + line.payableCents, 0);

  return {
    shipmentPackageId: String(pkg.shipmentPackageId ?? pkg.id ?? ""),
    orderNumber: String(pkg.orderNumber ?? ""),
    status: firstText(pkg.shipmentPackageStatus, pkg.status, "Unknown"),
    customerName: fullName,
    customerEmail: firstText(pkg.customerEmail, invoiceAddress.email) || undefined,
    customerIdentifier: firstText(pkg.taxNumber, pkg.identityNumber, invoiceAddress.taxNumber, invoiceAddress.identityNumber) || undefined,
    invoiceAddress: {
      fullName,
      addressLine: invoiceAddressLine(invoiceAddress),
      district: firstText(invoiceAddress.district, invoiceAddress.town),
      city: firstText(invoiceAddress.city, invoiceAddress.province),
      countryCode: firstText(invoiceAddress.countryCode, "TR"),
      taxOffice: firstText(invoiceAddress.taxOffice) || undefined
    },
    lines: normalizedLines,
    totalGrossCents: moneyCents(pkg.grossAmount) ?? lineGross,
    totalDiscountCents: moneyCents(pkg.totalDiscount) ?? lineDiscount,
    totalPayableCents: moneyCents(pkg.totalPrice) ?? linePayable,
    currency: firstText(pkg.currencyCode, pkg.currency, "TRY"),
    lastModifiedAt: timestampToDate(pkg.lastModifiedDate),
    deliveredAt: extractTrendyolDeliveryDate(pkg),
    raw: pkg
  };
}
