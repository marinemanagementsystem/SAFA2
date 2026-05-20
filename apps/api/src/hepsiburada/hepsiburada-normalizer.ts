import { centsToDecimal, toCents } from "../common/money";
import type { NormalizedOrder } from "../trendyol/trendyol-normalizer";

type RawRecord = Record<string, unknown>;

export interface HepsiburadaCatalogProduct {
  name: string;
  barcode?: string | null;
  merchantSku: string;
  brand: string;
  categoryName: string;
  vatRate: number;
  priceCents: number;
  stock: number;
  dispatchTime: number;
  description?: string | null;
}

export interface HepsiburadaListingPayloadSource {
  hbSku?: string | null;
  merchantSku: string;
  productName: string;
  priceCents: number;
  stock: number;
  dispatchTime: number;
}

export type HepsiburadaListingUploadKind = "price" | "stock";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function digitsOnly(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value)).replace(/\D/g, "");
  }
  return text(value).replace(/\D/g, "");
}

function firstIdentifier(...values: unknown[]) {
  for (const value of values) {
    const candidate = digitsOnly(value);
    if (candidate.length === 10 || candidate.length === 11) return candidate;
  }
  return "";
}

function moneyCents(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const amount = (value as RawRecord).amount ?? (value as RawRecord).Amount;
    return toCents(amount);
  }
  return toCents(value);
}

function dateFromUnknown(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }
  const candidate = text(value);
  if (!candidate) return undefined;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function deepPick(value: unknown, keys: string[]): unknown {
  const source = record(value);
  for (const key of keys) {
    const direct = source[key];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") return direct;
  }
  for (const item of Object.values(source)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const nested = deepPick(item, keys);
      if (nested !== undefined && nested !== null && String(nested).trim() !== "") return nested;
    }
  }
  return undefined;
}

export function buildHepsiburadaCatalogPayload(products: HepsiburadaCatalogProduct[]) {
  const records = products.map((product) => ({
    categoryName: product.categoryName,
    merchant: product.merchantSku,
    attributes: {
      Barcode: product.barcode ?? "",
      Brand: product.brand,
      ProductName: product.name,
      Description: product.description ?? product.name,
      VatRate: product.vatRate,
      Price: centsToDecimal(product.priceCents),
      AvailableStock: product.stock,
      DispatchTime: product.dispatchTime
    }
  }));

  return {
    fileName: "safa-hepsiburada-catalog.json",
    records,
    buffer: Buffer.from(JSON.stringify(records, null, 2), "utf8")
  };
}

export function buildHepsiburadaListingPayload(items: HepsiburadaListingPayloadSource[], kind: HepsiburadaListingUploadKind) {
  return items.map((item) => ({
    ...(item.hbSku ? { HepsiburadaSku: item.hbSku } : {}),
    MerchantSku: item.merchantSku,
    ProductName: item.productName,
    ...(kind === "price" ? { Price: centsToDecimal(item.priceCents) } : { AvailableStock: item.stock }),
    DispatchTime: item.dispatchTime
  }));
}

export function extractHepsiburadaTrackingId(response: unknown) {
  const candidate = deepPick(response, ["trackingId", "trackingID", "traceId", "TrackingId", "TrackingID"]);
  return candidate === undefined ? undefined : text(candidate) || undefined;
}

export function extractHepsiburadaJobId(response: unknown) {
  const candidate = deepPick(response, ["id", "Id", "ID", "uploadId", "inventoryUploadId"]);
  return candidate === undefined ? undefined : text(candidate) || undefined;
}

export function hepsiburadaLineItemId(line: RawRecord) {
  return firstText(line.id, line.lineItemId, line.LineItemId, line.lineitemid);
}

export function hepsiburadaLineOrderNumber(line: RawRecord) {
  return firstText(line.orderNumber, line.OrderNumber);
}

export function normalizeHepsiburadaOrderLine(line: RawRecord, packageNumber: string): NormalizedOrder {
  const invoice = record(line.invoice);
  const address = record(invoice.address);
  const hbSku = firstText(line.sku, line.hbSku, line.HepsiburadaSku);
  const merchantSku = firstText(line.merchantSku, line.MerchantSku);
  const quantity = Math.max(1, Math.trunc(numberValue(line.quantity, 1)));
  const unitPriceCents = moneyCents(line.unitPrice ?? line.price ?? line.Price);
  const totalPriceCents = moneyCents(line.totalPrice ?? line.TotalPrice) || unitPriceCents * quantity;
  const vatRate = numberValue(line.vatRate, numberValue(line.VatRate, 20));
  const orderNumber = hepsiburadaLineOrderNumber(line);
  const fullName = firstText(address.name, address.companyName, line.customerName, "Hepsiburada Musteri");
  const customerIdentifier = firstIdentifier(invoice.taxNumber, invoice.turkishIdentityNumber, invoice.identityNo);

  return {
    shipmentPackageId: `HB-${packageNumber}`,
    orderNumber,
    status: "PACKAGED",
    customerName: fullName,
    customerEmail: firstText(address.email, line.email) || undefined,
    customerIdentifier: customerIdentifier || undefined,
    customerType: digitsOnly(invoice.taxNumber).length === 10 ? "company" : "person",
    invoiceAddress: {
      fullName,
      addressLine: firstText(address.address, address.addressDetail, address.fullAddress),
      district: firstText(address.town, address.district),
      city: firstText(address.city),
      countryCode: firstText(address.countryCode, "TR"),
      taxOffice: firstText(invoice.taxOffice) || undefined
    },
    lines: [
      {
        sku: merchantSku || undefined,
        barcode: hbSku || undefined,
        productName: firstText(line.name, line.productName, merchantSku, hbSku, "Hepsiburada urunu"),
        quantity,
        unitPriceCents,
        grossCents: totalPriceCents,
        discountCents: 0,
        payableCents: totalPriceCents,
        vatRate
      }
    ],
    totalGrossCents: totalPriceCents,
    totalDiscountCents: 0,
    totalPayableCents: totalPriceCents,
    currency: firstText(record(line.totalPrice).currency, record(line.unitPrice).currency, "TRY"),
    lastModifiedAt: dateFromUnknown(line.lastStatusUpdateDate ?? line.orderDate),
    deliveredAt: undefined,
    raw: {
      source: "HEPSIBURADA",
      packageNumber,
      line
    }
  };
}

export function normalizeHepsiburadaError(status: number, data: unknown) {
  const message = typeof data === "string" ? data : JSON.stringify(data ?? {});
  if (status === 429) return "Hepsiburada limit asimi: istek sayisini azaltip tekrar deneyin.";
  if (/MinLock|MaxLock|OutOfPriceRange|ListingFrozen|threshold/i.test(message)) {
    return `Hepsiburada listing kilit/threshold uyarisi: ${message.slice(0, 240)}`;
  }
  return `Hepsiburada API HTTP ${status}: ${message.slice(0, 240)}`;
}
