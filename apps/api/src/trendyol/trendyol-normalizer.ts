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

  const normalizedLines = lines.map((line) => {
    const quantity = Math.max(1, numberValue(line.quantity, 1));
    const grossCents = toCents(line.amount ?? line.price ?? line.totalPrice);
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
      addressLine: firstText(invoiceAddress.address1, invoiceAddress.fullAddress, invoiceAddress.address),
      district: firstText(invoiceAddress.district, invoiceAddress.town),
      city: firstText(invoiceAddress.city, invoiceAddress.province),
      countryCode: firstText(invoiceAddress.countryCode, "TR"),
      taxOffice: firstText(invoiceAddress.taxOffice) || undefined
    },
    lines: normalizedLines,
    totalGrossCents: toCents(pkg.grossAmount) || lineGross,
    totalDiscountCents: toCents(pkg.totalDiscount) || lineDiscount,
    totalPayableCents: toCents(pkg.totalPrice) || linePayable,
    currency: firstText(pkg.currencyCode, pkg.currency, "TRY"),
    lastModifiedAt: timestampToDate(pkg.lastModifiedDate),
    deliveredAt: extractTrendyolDeliveryDate(pkg),
    raw: pkg
  };
}
