import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DraftStatus, ExternalInvoice, ExternalInvoiceSource, InvoiceStatus, Prisma } from "@prisma/client";
import axios from "axios";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { EarsivPortalService } from "../earsiv-portal/earsiv-portal.service";
import { buildGibPortalInvoiceDraftPayload, normalizePortalEttn } from "../earsiv-portal/portal-draft-payload";
import type { ArchiveInvoicePayload } from "../invoice/invoice-provider";
import { buildDraft } from "../orders/invoice-draft-builder";
import { PrismaService } from "../prisma/prisma.service";
import { TrendyolService } from "../trendyol/trendyol.service";
import { extractTrendyolDeliveryDate, normalizeTrendyolPackage, type NormalizedOrder } from "../trendyol/trendyol-normalizer";

type RawRecord = Record<string, unknown>;

interface NormalizedExternalInvoice {
  source: ExternalInvoiceSource;
  externalKey: string;
  invoiceNumber?: string;
  invoiceDate?: Date;
  buyerName?: string;
  buyerIdentifier?: string;
  orderNumber?: string;
  shipmentPackageId?: string;
  totalPayableCents?: number;
  currency: string;
  status?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  raw: RawRecord;
}

interface OrderMatchCandidate {
  id: string;
  shipmentPackageId: string;
  orderNumber: string;
  customerName: string;
  customerIdentifier: string | null;
  totalPayableCents: number;
  lastModifiedAt: Date | null;
}

interface PortalDraftMatchCandidate {
  id: string;
  orderId: string;
  orderNumber: string;
  shipmentPackageId: string;
  status: DraftStatus;
  portalDraftUuid?: string | null;
  portalDraftNumber?: string | null;
  portalDraftStatus?: string | null;
  invoice?: {
    id: string;
    provider: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    trendyolStatus?: string | null;
    pdfPath?: string | null;
  } | null;
}

interface MatchContext {
  orderBuyerNameCounts: Map<string, number>;
  externalBuyerNameCounts: Map<string, number>;
}

type GibPortalSyncMode = "preview" | "apply";

interface GibPortalSyncInput {
  days: number;
  startDate?: string;
  endDate?: string;
  mode?: GibPortalSyncMode;
  repairMissingDrafts?: boolean;
  repairOrderNumber?: string;
}

interface ImportRecordsOptions {
  includeInvoices?: boolean;
  autoPromoteGib?: boolean;
}

interface TrendyolMetadataSyncOptions {
  includeInvoices?: boolean;
}

type GibPortalFollowupEventType =
  | "portal_uploaded"
  | "signature_pending"
  | "signed_found"
  | "pdf_fetch_attempted"
  | "pdf_saved"
  | "pdf_missing"
  | "archived"
  | "trendyol_sent"
  | "trendyol_failed"
  | "trendyol_manual_detected"
  | "needs_manual_match";

type GibPortalFollowupSeverity = "info" | "success" | "warning" | "danger";

interface GibPortalTimelineEvent {
  type: GibPortalFollowupEventType;
  severity: GibPortalFollowupSeverity;
  message: string;
  at: string;
  externalInvoiceId?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  shipmentPackageId?: string;
  draftId?: string;
  nextAction?: string;
  metadata?: Record<string, unknown>;
}

interface GibPortalUnmatchedReason {
  externalInvoiceId?: string;
  invoiceNumber?: string;
  externalKey?: string;
  reason: string;
  candidateOrderNumber?: string;
  candidateShipmentPackageId?: string;
  score?: number;
}

interface GibPortalFollowupSummary {
  checkedCount: number;
  signedFound: number;
  promoted: number;
  pdfMissing: number;
  trendyolSent: number;
  trendyolAlreadySent: number;
  trendyolFailed: number;
  needsManualMatch: number;
  unmatchedReasons: GibPortalUnmatchedReason[];
  timelineEvents: GibPortalTimelineEvent[];
}

interface OrderMatchResult {
  order: OrderMatchCandidate;
  score: number;
  reason: string;
  autoApply: boolean;
}

interface MatchableExternalInvoice {
  source: ExternalInvoiceSource;
  externalKey: string;
  invoiceNumber?: string | null;
  invoiceDate?: Date | null;
  buyerName?: string | null;
  buyerIdentifier?: string | null;
  orderNumber?: string | null;
  shipmentPackageId?: string | null;
  totalPayableCents?: number | null;
  raw?: unknown;
}

const fieldAliases = {
  externalId: [
    "externalId",
    "id",
    "uuid",
    "ettn",
    "ETTN",
    "ettnId",
    "faturaUuid",
    "belgeUuid",
    "belgeOid",
    "faturaOid",
    "documentId",
    "invoiceLink",
    "invoiceUrl",
    "faturaLinki"
  ],
  invoiceNumber: ["invoiceNumber", "invoiceNo", "faturaNo", "faturaNumarasi", "belgeNo", "belgeNumarasi", "documentNumber", "seriSiraNo"],
  invoiceDate: ["invoiceDate", "faturaTarihi", "duzenlenmeTarihi", "belgeTarihi", "tarih", "issueDate", "date"],
  buyerName: ["buyerName", "alici", "aliciUnvan", "aliciUnvanAdSoyad", "unvan", "adSoyad", "musteri", "customerName"],
  buyerIdentifier: ["buyerIdentifier", "aliciVknTckn", "vknTckn", "vkn", "tckn", "vergiNo", "taxId"],
  orderNumber: ["orderNumber", "siparisNo", "siparisNumarasi", "orderNo", "merchantOrderNumber"],
  shipmentPackageId: ["shipmentPackageId", "paketNo", "paketNumarasi", "cargoTrackingNumber", "packageId"],
  total: ["totalPayableCents", "totalPayable", "payableAmount", "odenecekTutar", "genelToplam", "toplamTutar", "tutar"],
  currency: ["currency", "paraBirimi", "doviz", "currencyCode"],
  status: ["status", "durum", "belgeDurumu", "onayDurumu", "onayDurumuAciklama", "faturaDurumu", "invoiceStatus"],
  pdfUrl: ["pdfUrl", "invoicePdfUrl", "faturaPdfUrl", "invoiceLink", "invoiceUrl", "faturaLinki", "pdf", "downloadUrl"],
  xmlUrl: ["xmlUrl", "invoiceXmlUrl", "faturaXmlUrl", "xml"]
} satisfies Record<string, string[]>;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizedKey(key: string) {
  return key.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]/gi, "");
}

function flattenRecord(value: unknown, target = new Map<string, unknown>()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return target;

  for (const [key, item] of Object.entries(value as RawRecord)) {
    target.set(normalizedKey(key), item);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      flattenRecord(item, target);
    }
  }

  return target;
}

function pickValue(flat: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = flat.get(normalizedKey(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function stringField(flat: Map<string, unknown>, aliases: string[]) {
  const value = pickValue(flat, aliases);
  if (value === undefined) return undefined;
  return String(value).trim();
}

function digits(value?: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeText(value?: string | null) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function incrementCount(counts: Map<string, number>, value?: string | null) {
  const key = normalizeText(value);
  if (!key) return;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const text = String(value ?? "").trim();
  if (!text) return undefined;

  const trDate = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (trDate) {
    const [, day, month, year, hour = "0", minute = "0"] = trDate;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function istanbulDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function istanbulDayWindow(date = new Date()) {
  const dateKey = istanbulDateKey(date);
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { dateKey, start, end };
}

function todayGibPortalInput(date = new Date()) {
  const { dateKey } = istanbulDayWindow(date);
  return {
    startDate: `${dateKey}T00:00:00+03:00`,
    endDate: `${dateKey}T23:59:59+03:00`
  };
}

function invoiceDateWhere(input?: { startDate?: string; endDate?: string }) {
  const start = input?.startDate ? parseDate(input.startDate) : undefined;
  const end = input?.endDate ? parseDate(input.endDate) : undefined;
  if (input?.startDate && !start) throw new BadRequestException("Fatura takip baslangic tarihi okunamadi.");
  if (input?.endDate && !end) throw new BadRequestException("Fatura takip bitis tarihi okunamadi.");
  if (!start && !end) return {};
  return {
    invoiceDate: {
      ...(start ? { gte: start } : {}),
      ...(end ? { lte: end } : {})
    }
  };
}

function isMay20RepairRange(start: Date, end: Date) {
  return istanbulDateKey(start) === "2026-05-20" && istanbulDateKey(end) === "2026-05-20" && start.getTime() <= end.getTime();
}

function resolveGibPortalRange(input: GibPortalSyncInput) {
  const end = input.endDate ? parseDate(input.endDate) : new Date();
  const start = input.startDate ? parseDate(input.startDate) : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
  if (!start || !end) throw new BadRequestException("e-Arsiv sorgu tarihleri okunamadi.");
  if (input.repairMissingDrafts && !isMay20RepairRange(start, end)) {
    throw new BadRequestException("Eksik fatura onarimi yalnizca 20.05.2026 gunu icin calistirilabilir.");
  }
  return { start, end };
}

function isDateInRange(date: Date | null | undefined, start: Date, end: Date) {
  if (!date) return false;
  const time = date.getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function parseMoneyCents(value: unknown, keyHint?: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value === "number" && Number.isFinite(value)) {
    return keyHint?.toLocaleLowerCase("tr-TR").includes("cents") ? Math.round(value) : Math.round(value * 100);
  }

  const text = String(value).trim();
  if (!text) return undefined;

  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return undefined;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,(?=\d{3}\b)/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

function isDateClose(left: Date | null | undefined, right: Date | null | undefined, maxDays: number) {
  if (!left || !right) return false;
  const difference = Math.abs(left.getTime() - right.getTime());
  return difference <= maxDays * 24 * 60 * 60 * 1000;
}

function hashRecord(record: RawRecord) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 24);
}

function sourceLabel(source: ExternalInvoiceSource) {
  if (source === ExternalInvoiceSource.GIB_PORTAL) return "e-Arsiv Portal";
  if (source === ExternalInvoiceSource.TRENDYOL) return "Trendyol";
  return "Manuel";
}

function orderPackageKey(value?: string | null) {
  const text = String(value ?? "").trim();
  return text ? `package:${text}` : undefined;
}

function orderNumberKey(value?: string | null) {
  const text = String(value ?? "").trim();
  return text ? `order:${text}` : undefined;
}

function addKey(target: Set<string>, value?: string) {
  if (value) target.add(value);
}

function invoiceSourceLabel(provider?: string | null) {
  if (provider === "gib-portal-manual") return "e-Arsiv manuel";
  if (provider === "gib-direct") return "GIB direct";
  return "SAFA";
}

function normalizedStatusText(value?: string | null) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function isCancelledStatus(value?: string | null) {
  const text = normalizedStatusText(value);
  return /iptal|silindi|hata|reddedildi/.test(text);
}

function isDraftStatus(value?: string | null) {
  const text = normalizedStatusText(value);
  return /taslak|onaylanmadi|onay bekliyor|imza bekliyor/.test(text);
}

function isSignedGibInvoice(invoice: {
  source: ExternalInvoiceSource;
  status?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: Date | null;
  raw?: unknown;
}) {
  if (invoice.source !== ExternalInvoiceSource.GIB_PORTAL) return false;
  if (isCancelledStatus(invoice.status) || isDraftStatus(invoice.status)) return false;

  const raw = invoice.raw && typeof invoice.raw === "object" && !Array.isArray(invoice.raw) ? (invoice.raw as RawRecord) : {};
  const statusText = normalizedStatusText(invoice.status);
  const command = String(raw.kaynakKomut ?? raw.sourceCommand ?? "");
  const explicitSigned = /onaylandi|imzalandi|imzali|kesildi|duzenlendi|basarili/.test(statusText);
  const issuedCommand = /ADIMA_KESILEN|KESILEN|ONAYLI/i.test(command);

  return Boolean(invoice.invoiceNumber && invoice.invoiceDate && (explicitSigned || issuedCommand));
}

function extractExternalUuid(invoice: ExternalInvoice) {
  const candidates = [
    invoice.externalKey,
    invoice.raw && typeof invoice.raw === "object" ? (invoice.raw as RawRecord).faturaUuid : undefined,
    invoice.raw && typeof invoice.raw === "object" ? (invoice.raw as RawRecord).uuid : undefined,
    invoice.raw && typeof invoice.raw === "object" ? (invoice.raw as RawRecord).ettnId : undefined,
    invoice.raw && typeof invoice.raw === "object" ? (invoice.raw as RawRecord).ettn : undefined,
    invoice.raw && typeof invoice.raw === "object" ? (invoice.raw as RawRecord).ETTN : undefined
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    try {
      return normalizePortalEttn(String(candidate));
    } catch {
      continue;
    }
  }

  return undefined;
}

function safeFileStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "invoice";
}

function isLikelyPdfUrl(value?: string | null) {
  if (!value) return false;
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function mergeRawWithUpload(raw: Prisma.JsonValue, uploadedPdfPath: string) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RawRecord) : {};
  return json({ ...base, uploadedPdfPath });
}

function mergeRawWithOfficialPdf(
  raw: Prisma.JsonValue,
  input: { uploadedPdfPath: string; pdfUrl?: string | null; source?: string; raw?: unknown }
) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RawRecord) : {};
  return json({
    ...base,
    uploadedPdfPath: input.uploadedPdfPath,
    ...(input.pdfUrl ? { officialPdfUrl: input.pdfUrl } : {}),
    ...(input.source ? { officialPdfSource: input.source } : {}),
    ...(input.raw ? { officialPdfResponse: input.raw } : {}),
    officialPdfFetchedAt: new Date().toISOString()
  });
}

function mergeRawWithMatchSuggestion(raw: Prisma.JsonValue, match: OrderMatchResult) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as RawRecord) : {};
  return json({
    ...base,
    matchSuggestion: {
      orderId: match.order.id,
      orderNumber: match.order.orderNumber,
      shipmentPackageId: match.order.shipmentPackageId,
      score: match.score,
      reason: match.reason
    }
  });
}

function matchSuggestionFromRaw(raw: Prisma.JsonValue) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const suggestion = (raw as RawRecord).matchSuggestion;
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) return undefined;
  const record = suggestion as RawRecord;
  return {
    orderNumber: typeof record.orderNumber === "string" ? record.orderNumber : undefined,
    shipmentPackageId: typeof record.shipmentPackageId === "string" ? record.shipmentPackageId : undefined,
    score: typeof record.score === "number" ? record.score : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined
  };
}

function emptyFollowup(): GibPortalFollowupSummary {
  return {
    checkedCount: 0,
    signedFound: 0,
    promoted: 0,
    pdfMissing: 0,
    trendyolSent: 0,
    trendyolAlreadySent: 0,
    trendyolFailed: 0,
    needsManualMatch: 0,
    unmatchedReasons: [],
    timelineEvents: []
  };
}

function eventFor(input: Omit<GibPortalTimelineEvent, "at"> & { at?: string }): GibPortalTimelineEvent {
  return { at: input.at ?? new Date().toISOString(), ...input };
}

function resultWithFollowup(
  base: {
    imported: number;
    matched: number;
    unmatched: number;
    invoices: unknown[];
    message?: string;
  },
  followup: GibPortalFollowupSummary
) {
  return {
    ...base,
    checkedCount: followup.checkedCount,
    signedFound: followup.signedFound,
    promoted: followup.promoted,
    pdfMissing: followup.pdfMissing,
    trendyolSent: followup.trendyolSent,
    trendyolAlreadySent: followup.trendyolAlreadySent,
    trendyolFailed: followup.trendyolFailed,
    unmatchedReasons: followup.unmatchedReasons,
    timelineEvents: followup.timelineEvents,
    followup
  };
}

function mergeFollowups(target: GibPortalFollowupSummary, source: GibPortalFollowupSummary) {
  target.checkedCount += source.checkedCount;
  target.signedFound += source.signedFound;
  target.promoted += source.promoted;
  target.pdfMissing += source.pdfMissing;
  target.trendyolSent += source.trendyolSent;
  target.trendyolAlreadySent += source.trendyolAlreadySent;
  target.trendyolFailed += source.trendyolFailed;
  target.needsManualMatch += source.needsManualMatch;
  target.unmatchedReasons.push(...source.unmatchedReasons);
  target.timelineEvents.push(...source.timelineEvents);
  return target;
}

function normalizeRecord(source: ExternalInvoiceSource, record: RawRecord): NormalizedExternalInvoice {
  const flat = flattenRecord(record);
  const externalId = stringField(flat, fieldAliases.externalId);
  const invoiceNumber = stringField(flat, fieldAliases.invoiceNumber);
  const totalValue = pickValue(flat, fieldAliases.total);
  const totalKey = fieldAliases.total.find((alias) => flat.has(normalizedKey(alias)));

  const externalKey = externalId ?? invoiceNumber ?? hashRecord(record);
  if (!externalKey) {
    throw new BadRequestException("Harici fatura kaydinda fatura numarasi, ETTN veya benzersiz kayit anahtari bulunamadi.");
  }

  return {
    source,
    externalKey,
    invoiceNumber,
    invoiceDate: parseDate(pickValue(flat, fieldAliases.invoiceDate)),
    buyerName: stringField(flat, fieldAliases.buyerName),
    buyerIdentifier: digits(stringField(flat, fieldAliases.buyerIdentifier)) || undefined,
    orderNumber: stringField(flat, fieldAliases.orderNumber),
    shipmentPackageId: stringField(flat, fieldAliases.shipmentPackageId),
    totalPayableCents: parseMoneyCents(totalValue, totalKey),
    currency: stringField(flat, fieldAliases.currency) ?? "TRY",
    status: stringField(flat, fieldAliases.status),
    pdfUrl: stringField(flat, fieldAliases.pdfUrl),
    xmlUrl: stringField(flat, fieldAliases.xmlUrl),
    raw: record
  };
}

function hasInvoiceSignal(record: NormalizedExternalInvoice) {
  return Boolean(record.invoiceNumber || record.pdfUrl || record.xmlUrl || record.raw.ettn || record.raw.uuid || record.raw.invoiceLink);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rawRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

function orderInvoiceSignal(raw: unknown) {
  const record = rawRecord(raw);
  return (
    textValue(record.invoiceLink) ||
    textValue(record.invoiceUrl) ||
    textValue(record.invoiceNumber) ||
    textValue(record.faturaNo) ||
    textValue(record.ettn) ||
    textValue(record.uuid) ||
    undefined
  );
}

function storedOrderToNormalized(order: {
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail?: string | null;
  customerIdentifier?: string | null;
  invoiceAddress: Prisma.JsonValue;
  raw: Prisma.JsonValue;
  totalGrossCents: number;
  totalDiscountCents: number;
  totalPayableCents: number;
  currency: string;
  lastModifiedAt?: Date | null;
}): NormalizedOrder {
  const storedAddress = rawRecord(order.invoiceAddress);
  const normalized = normalizeTrendyolPackage({
    ...rawRecord(order.raw),
    shipmentPackageId: order.shipmentPackageId,
    orderNumber: order.orderNumber,
    shipmentPackageStatus: order.status,
    status: order.status
  });
  return {
    ...normalized,
    shipmentPackageId: order.shipmentPackageId,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: normalized.customerName || order.customerName,
    customerEmail: normalized.customerEmail ?? order.customerEmail ?? undefined,
    customerIdentifier: normalized.customerIdentifier ?? order.customerIdentifier ?? undefined,
    invoiceAddress: normalized.invoiceAddress.addressLine
      ? normalized.invoiceAddress
      : {
          fullName: textValue(storedAddress.fullName) || order.customerName,
          addressLine: textValue(storedAddress.addressLine),
          district: textValue(storedAddress.district),
          city: textValue(storedAddress.city),
          countryCode: textValue(storedAddress.countryCode) || "TR",
          taxOffice: textValue(storedAddress.taxOffice) || undefined
        },
    totalGrossCents: order.totalGrossCents,
    totalDiscountCents: order.totalDiscountCents,
    totalPayableCents: order.totalPayableCents,
    currency: order.currency,
    lastModifiedAt: normalized.lastModifiedAt ?? order.lastModifiedAt ?? undefined,
    raw: rawRecord(order.raw)
  };
}

function providerPayloadFromDraft(order: NormalizedOrder, draft: ReturnType<typeof buildDraft>): ArchiveInvoicePayload {
  return {
    orderNumber: order.orderNumber,
    shipmentPackageId: order.shipmentPackageId,
    buyerName: order.customerName,
    buyerIdentifier: String(draft.totals.buyerIdentifier ?? order.customerIdentifier ?? "11111111111"),
    buyerType: draft.totals.buyerType === "company" || draft.totals.buyerType === "person" ? draft.totals.buyerType : undefined,
    address: {
      addressLine: order.invoiceAddress.addressLine,
      district: order.invoiceAddress.district,
      city: order.invoiceAddress.city,
      countryCode: order.invoiceAddress.countryCode || "TR",
      taxOffice: order.invoiceAddress.taxOffice
    },
    lines: draft.lines,
    totals: {
      grossCents: Number(draft.totals.grossCents ?? order.totalGrossCents),
      discountCents: Number(draft.totals.discountCents ?? order.totalDiscountCents),
      payableCents: Number(draft.totals.payableCents ?? order.totalPayableCents),
      currency: String(draft.totals.currency ?? order.currency)
    }
  };
}

function mapExternalInvoice(
  invoice: ExternalInvoice & { matchedOrder?: { orderNumber: string; shipmentPackageId: string } | null },
  promotedByExternalKey = new Map<string, { id: string; invoiceNumber: string; status: InvoiceStatus; pdfPath?: string | null }>()
) {
  const promoted = promotedByExternalKey.get(invoice.externalKey);
  const suggestion = matchSuggestionFromRaw(invoice.raw);
  return {
    id: invoice.id,
    source: invoice.source,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    invoiceDate: invoice.invoiceDate?.toISOString(),
    buyerName: invoice.buyerName ?? undefined,
    buyerIdentifier: invoice.buyerIdentifier ?? undefined,
    orderNumber: invoice.orderNumber ?? undefined,
    shipmentPackageId: invoice.shipmentPackageId ?? undefined,
    totalPayableCents: invoice.totalPayableCents ?? undefined,
    currency: invoice.currency,
    status: invoice.status ?? undefined,
    pdfUrl: invoice.pdfUrl ?? undefined,
    xmlUrl: invoice.xmlUrl ?? undefined,
    matchedOrderId: invoice.matchedOrderId ?? undefined,
    matchedOrderNumber: invoice.matchedOrder?.orderNumber,
    matchedShipmentPackageId: invoice.matchedOrder?.shipmentPackageId,
    matchScore: invoice.matchScore,
    matchReason: invoice.matchReason ?? undefined,
    suggestedOrderNumber: suggestion?.orderNumber,
    suggestedShipmentPackageId: suggestion?.shipmentPackageId,
    suggestedMatchScore: suggestion?.score,
    suggestedMatchReason: suggestion?.reason,
    promotedInvoiceId: promoted?.id,
    promotedInvoiceNumber: promoted?.invoiceNumber,
    promotedInvoiceStatus: promoted?.status,
    requiresPdfUpload: Boolean(promoted && !promoted.pdfPath),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

@Injectable()
export class ExternalInvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EarsivPortalService) private readonly earsivPortal: EarsivPortalService,
    @Inject(TrendyolService) private readonly trendyol: TrendyolService
  ) {}

  async list(source?: ExternalInvoiceSource) {
    const [invoices, promotedByExternalKey] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where: source ? { source } : undefined,
        include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } },
        orderBy: [{ updatedAt: "desc" }],
        take: 5000
      }),
      this.promotedInvoiceMap()
    ]);

    return invoices.map((invoice) => mapExternalInvoice(invoice, promotedByExternalKey));
  }

  async importRecords(source: ExternalInvoiceSource, records: RawRecord[], options: ImportRecordsOptions = {}) {
    let imported = 0;
    const upsertedIds: string[] = [];

    for (const record of records) {
      const normalized = normalizeRecord(source, record);
      const upserted = await this.upsertNormalized(normalized);
      if (upserted?.id) upsertedIds.push(upserted.id);
      imported += 1;
    }

    const reconcile = await this.reconcile(source, { externalInvoiceIds: upsertedIds });
    const manualTrendyol =
      source === ExternalInvoiceSource.TRENDYOL ? await this.markManualTrendyolInvoicesFromExternal(upsertedIds) : undefined;
    const shouldPromote = options.autoPromoteGib ?? true;
    const promotion =
      source === ExternalInvoiceSource.GIB_PORTAL && shouldPromote
        ? await this.promoteSignedGibInvoices({ autoSendTrendyol: true, externalInvoiceIds: upsertedIds })
        : undefined;
    return {
      ...(promotion ?? {}),
      imported,
      matched: reconcile.matched,
      unmatched: reconcile.unmatched,
      ...(manualTrendyol ? { trendyolManualDetected: manualTrendyol.updated } : {}),
      invoices: options.includeInvoices === false ? [] : await this.list(source)
    };
  }

  async previewGibPortalSync(input: Omit<GibPortalSyncInput, "mode">) {
    return this.syncGibPortal({ ...input, mode: "preview" });
  }

  async applyGibPortalSync(input: Omit<GibPortalSyncInput, "mode">) {
    return this.syncGibPortal({ ...input, mode: "apply" });
  }

  async syncGibPortal(input: GibPortalSyncInput) {
    const mode = input.mode ?? "apply";
    const { start, end } = resolveGibPortalRange(input);

    let records: RawRecord[];
    try {
      records = await this.earsivPortal.listIssuedInvoices(start, end);
    } catch (error) {
      if (mode === "apply") {
        await this.writeFollowupAudit(this.portalQueryErrorEvent(error, { start, end, mode }));
      }
      throw error;
    }
    if (records.length === 0) {
      const followup = emptyFollowup();
      followup.timelineEvents.push(
        eventFor({
          type: "signature_pending",
          severity: "info",
          message: "e-Arsiv portal sorgusu tamamlandi; bu aralikta fatura bulunamadi.",
          metadata: { startDate: start.toISOString(), endDate: end.toISOString(), count: 0, mode }
        })
      );
      if (input.repairMissingDrafts) {
        mergeFollowups(
          followup,
          await this.repairMissingPortalDrafts({
            start,
            end,
            mode,
            orderNumber: input.repairOrderNumber
          })
        );
      }
      if (mode === "apply") await this.writeFollowupAudit(followup.timelineEvents[0]);
      return resultWithFollowup({ imported: 0, matched: 0, unmatched: 0, invoices: await this.list(ExternalInvoiceSource.GIB_PORTAL) }, followup);
    }

    const normalizedRecords = records.map((record) => normalizeRecord(ExternalInvoiceSource.GIB_PORTAL, record));
    if (mode === "preview") {
      const preview = await this.previewGibPortalRecords(normalizedRecords);
      if (input.repairMissingDrafts) {
        mergeFollowups(
          preview.followup,
          await this.repairMissingPortalDrafts({
            start,
            end,
            mode,
            orderNumber: input.repairOrderNumber
          })
        );
      }
      return resultWithFollowup(
        {
          imported: 0,
          matched: preview.matched,
          unmatched: preview.unmatched,
          invoices: await this.list(ExternalInvoiceSource.GIB_PORTAL),
          message: "Preview modu: DB'ye fatura, eslesme veya Trendyol gonderimi yazilmadi."
        },
        preview.followup
      );
    }

    const result = await this.importRecords(ExternalInvoiceSource.GIB_PORTAL, records);
    if (!input.repairMissingDrafts) return result;

    const resultFollowup = result.followup ?? emptyFollowup();
    mergeFollowups(
      resultFollowup,
      await this.repairMissingPortalDrafts({
        start,
        end,
        mode,
        orderNumber: input.repairOrderNumber
      })
    );
    return resultWithFollowup(
      {
        imported: result.imported,
        matched: result.matched,
        unmatched: result.unmatched,
        invoices: await this.list(ExternalInvoiceSource.GIB_PORTAL),
        message: result.message
      },
      resultFollowup
    );
  }

  async runGibPortalApplyJobStep(
    payload: Record<string, any>,
    response: Record<string, any> = {}
  ): Promise<{ payload: Record<string, any>; response: Record<string, any>; done: boolean; message: string }> {
    const phase = payload.phase ?? "query";
    const input: GibPortalSyncInput = {
      days: Number(payload.input?.days ?? 30),
      startDate: payload.input?.startDate,
      endDate: payload.input?.endDate,
      mode: "apply",
      repairMissingDrafts: Boolean(payload.input?.repairMissingDrafts),
      repairOrderNumber: payload.input?.repairOrderNumber
    };
    const batchSize = Number(payload.batchSize ?? 25);

    if (phase === "query") {
      const { start, end } = resolveGibPortalRange(input);
      let records: RawRecord[];
      try {
        records = await this.earsivPortal.listIssuedInvoices(start, end);
      } catch (error) {
        const event = this.portalQueryErrorEvent(error, { start, end, mode: "apply" });
        await this.writeFollowupAudit(event);
        throw error;
      }

      const nextPayload = {
        ...payload,
        phase: records.length > 0 ? "import" : input.repairMissingDrafts ? "repair" : "done",
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        records,
        cursor: 0,
        batchSize
      };
      const nextResponse = {
        ...response,
        checkedCount: records.length,
        imported: 0,
        matched: 0,
        unmatched: 0,
        signedFound: 0,
        promoted: 0,
        pdfMissing: 0,
        trendyolSent: 0,
        trendyolAlreadySent: 0,
        trendyolFailed: 0,
        needsManualMatch: 0,
        message:
          records.length > 0
            ? `${records.length} e-Arsiv portal kaydi alindi; guvenli uygulama parca parca islenecek.`
            : "e-Arsiv portal sorgusu tamamlandi; bu aralikta fatura bulunamadi."
      };

      if (nextPayload.phase === "done") {
        return { payload: nextPayload, response: nextResponse, done: true, message: nextResponse.message };
      }

      return { payload: nextPayload, response: nextResponse, done: false, message: nextResponse.message };
    }

    if (phase === "import") {
      const records = Array.isArray(payload.records) ? (payload.records as RawRecord[]) : [];
      const cursor = Number(payload.cursor ?? 0);
      const batch = records.slice(cursor, cursor + batchSize);

      if (batch.length === 0) {
        return this.runGibPortalApplyJobStep({ ...payload, phase: input.repairMissingDrafts ? "repair" : "done" }, response);
      }

      const result = await this.importRecords(ExternalInvoiceSource.GIB_PORTAL, batch, { includeInvoices: false, autoPromoteGib: true });
      const followup = result.followup ?? emptyFollowup();
      const nextCursor = cursor + batch.length;
      const nextPayload = {
        ...payload,
        cursor: nextCursor,
        phase: nextCursor >= records.length ? (input.repairMissingDrafts ? "repair" : "done") : "import"
      };
      const nextResponse = {
        ...response,
        imported: Number(response.imported ?? 0) + result.imported,
        matched: Number(response.matched ?? 0) + result.matched,
        unmatched: Number(response.unmatched ?? 0) + result.unmatched,
        signedFound: Number(response.signedFound ?? 0) + (result.signedFound ?? followup.signedFound ?? 0),
        promoted: Number(response.promoted ?? 0) + (result.promoted ?? followup.promoted ?? 0),
        pdfMissing: Number(response.pdfMissing ?? 0) + (result.pdfMissing ?? followup.pdfMissing ?? 0),
        trendyolSent: Number(response.trendyolSent ?? 0) + (result.trendyolSent ?? followup.trendyolSent ?? 0),
        trendyolAlreadySent: Number(response.trendyolAlreadySent ?? 0) + (result.trendyolAlreadySent ?? followup.trendyolAlreadySent ?? 0),
        trendyolFailed: Number(response.trendyolFailed ?? 0) + (result.trendyolFailed ?? followup.trendyolFailed ?? 0),
        needsManualMatch: Number(response.needsManualMatch ?? 0) + (followup.needsManualMatch ?? 0),
        message:
          nextCursor >= records.length
            ? "GIB portal kayitlari islendi; onarim adimi kontrol ediliyor."
            : `${Math.min(nextCursor, records.length)}/${records.length} GIB portal kaydi islendi.`
      };

      return {
        payload: nextPayload,
        response: nextResponse,
        done: nextPayload.phase === "done",
        message: nextResponse.message
      };
    }

    if (phase === "repair") {
      const start = parseDate(payload.startDate);
      const end = parseDate(payload.endDate);
      if (!start || !end) throw new BadRequestException("GIB job onarim tarihleri okunamadi.");
      const repair = await this.repairMissingPortalDrafts({
        start,
        end,
        mode: "apply",
        orderNumber: input.repairOrderNumber
      });
      const nextResponse = {
        ...response,
        repairCheckedCount: repair.checkedCount,
        signedFound: Number(response.signedFound ?? 0) + repair.signedFound,
        promoted: Number(response.promoted ?? 0) + repair.promoted,
        pdfMissing: Number(response.pdfMissing ?? 0) + repair.pdfMissing,
        trendyolSent: Number(response.trendyolSent ?? 0) + repair.trendyolSent,
        trendyolAlreadySent: Number(response.trendyolAlreadySent ?? 0) + repair.trendyolAlreadySent,
        trendyolFailed: Number(response.trendyolFailed ?? 0) + repair.trendyolFailed,
        needsManualMatch: Number(response.needsManualMatch ?? 0) + repair.needsManualMatch,
        message: "GIB portal uygulama ve 20 Mayis onarim kontrolu tamamlandi."
      };
      return {
        payload: { ...payload, phase: "done", repairDone: true },
        response: nextResponse,
        done: true,
        message: nextResponse.message
      };
    }

    return {
      payload: { ...payload, phase: "done" },
      response: { ...response, message: response.message ?? "GIB portal uygulama tamamlandi." },
      done: true,
      message: String(response.message ?? "GIB portal uygulama tamamlandi.")
    };
  }

  async runGibPortalFollowupJobStep(
    payload: Record<string, any>,
    response: Record<string, any> = {}
  ): Promise<{ payload: Record<string, any>; response: Record<string, any>; done: boolean; message: string }> {
    const phase = payload.phase ?? "gib-apply";
    const requestedInput = payload.input && typeof payload.input === "object" ? payload.input : {};
    const followupInput =
      requestedInput.startDate || requestedInput.endDate
        ? { startDate: requestedInput.startDate, endDate: requestedInput.endDate }
        : todayGibPortalInput();

    if (phase === "gib-apply") {
      const applyPayload =
        payload.applyPayload ??
        ({
          kind: "gib-portal-apply",
          phase: "query",
          input: followupInput
        } as Record<string, any>);
      const step = await this.runGibPortalApplyJobStep(applyPayload, response);
      if (!step.done) {
        return {
          payload: { ...payload, phase: "gib-apply", applyPayload: step.payload },
          response: step.response,
          done: false,
          message: step.message
        };
      }

      return {
        payload: { ...payload, phase: "promote-existing", applyPayload: step.payload },
        response: step.response,
        done: false,
        message: "GIB portal sorgusu tamamlandi; PDF bekleyen arsiv kayitlari kontrol ediliyor."
      };
    }

    if (phase === "promote-existing") {
      const promotion = await this.promoteSignedGibInvoices({
        autoSendTrendyol: true,
        startDate: followupInput.startDate,
        endDate: followupInput.endDate
      });
      const followup = promotion.followup ?? emptyFollowup();
      const nextResponse = {
        ...response,
        signedFound: Number(response.signedFound ?? 0) + (promotion.signedFound ?? followup.signedFound ?? 0),
        promoted: Number(response.promoted ?? 0) + (promotion.promoted ?? followup.promoted ?? 0),
        pdfMissing: Number(response.pdfMissing ?? 0) + (promotion.pdfMissing ?? followup.pdfMissing ?? 0),
        trendyolSent: Number(response.trendyolSent ?? 0) + (promotion.trendyolSent ?? followup.trendyolSent ?? 0),
        trendyolAlreadySent: Number(response.trendyolAlreadySent ?? 0) + (promotion.trendyolAlreadySent ?? followup.trendyolAlreadySent ?? 0),
        trendyolFailed: Number(response.trendyolFailed ?? 0) + (promotion.trendyolFailed ?? followup.trendyolFailed ?? 0),
        needsManualMatch: Number(response.needsManualMatch ?? 0) + (followup.needsManualMatch ?? 0),
        message: "GIB portal imza/PDF/Trendyol takibi tamamlandi."
      };
      return {
        payload: { ...payload, phase: "done" },
        response: nextResponse,
        done: true,
        message: nextResponse.message
      };
    }

    return {
      payload: { ...payload, phase: "done" },
      response: { ...response, message: response.message ?? "GIB portal takibi tamamlandi." },
      done: true,
      message: String(response.message ?? "GIB portal takibi tamamlandi.")
    };
  }

  async promoteOne(externalInvoiceId: string, options: { autoSendTrendyol?: boolean } = {}) {
    return this.promoteSignedGibInvoices({ ...options, externalInvoiceId });
  }

  async attachOfficialPdf(externalInvoiceId: string, file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number }) {
    if (!file?.buffer?.length) throw new BadRequestException("Resmi fatura PDF dosyasi yuklenmeli.");
    if (file.mimetype && file.mimetype !== "application/pdf") throw new BadRequestException("Yalnizca resmi PDF dosyasi yuklenebilir.");
    if (file.size && file.size > 10 * 1024 * 1024) throw new BadRequestException("PDF dosyasi 10 MB'dan buyuk olamaz.");

    const externalInvoice = await this.prisma.externalInvoice.findUnique({ where: { id: externalInvoiceId } });
    if (!externalInvoice) throw new NotFoundException("Harici fatura bulunamadi.");
    if (!externalInvoice.invoiceNumber) throw new BadRequestException("PDF yuklemek icin harici faturada fatura numarasi bulunmali.");

    const pdfPath = await this.writeInvoicePdf(externalInvoice.invoiceNumber, file.buffer);
    await this.prisma.externalInvoice.update({
      where: { id: externalInvoice.id },
      data: {
        raw: mergeRawWithUpload(externalInvoice.raw, pdfPath),
        pdfUrl: externalInvoice.pdfUrl ?? `uploaded://${safeFileStem(file.originalname ?? externalInvoice.invoiceNumber)}.pdf`
      }
    });

    return this.promoteSignedGibInvoices({ externalInvoiceId, autoSendTrendyol: true, forcedPdfPath: pdfPath });
  }

  async syncTrendyolMetadata(options: TrendyolMetadataSyncOptions = {}) {
    const orders = await this.prisma.order.findMany({
      select: {
        orderNumber: true,
        shipmentPackageId: true,
        customerName: true,
        customerIdentifier: true,
        totalPayableCents: true,
        currency: true,
        raw: true
      },
      take: 5000
    });

    const records: RawRecord[] = [];
    for (const order of orders) {
      const record = {
        ...(order.raw as RawRecord),
        orderNumber: order.orderNumber,
        shipmentPackageId: order.shipmentPackageId,
        buyerName: order.customerName,
        buyerIdentifier: order.customerIdentifier,
        totalPayableCents: order.totalPayableCents,
        currency: order.currency
      };
      const normalized = normalizeRecord(ExternalInvoiceSource.TRENDYOL, record);
      if (hasInvoiceSignal(normalized)) records.push(record);
    }

    if (records.length === 0) {
      return {
        imported: 0,
        matched: 0,
        unmatched: 0,
        message: "Trendyol siparis verisinde fatura numarasi veya PDF/XML baglantisi bulunamadi.",
        invoices: options.includeInvoices === false ? [] : await this.list(ExternalInvoiceSource.TRENDYOL)
      };
    }

    return this.importRecords(ExternalInvoiceSource.TRENDYOL, records, { includeInvoices: options.includeInvoices });
  }

  private async markManualTrendyolInvoicesFromExternal(externalInvoiceIds: string[]) {
    if (externalInvoiceIds.length === 0) return { updated: 0 };

    const trendYolInvoices = await this.prisma.externalInvoice.findMany({
      where: { id: { in: externalInvoiceIds }, source: ExternalInvoiceSource.TRENDYOL },
      include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } },
      take: 5000
    });
    if (trendYolInvoices.length === 0) return { updated: 0 };

    const trendYolKeys = new Set<string>();
    for (const invoice of trendYolInvoices as any[]) {
      addKey(trendYolKeys, orderPackageKey(invoice.matchedOrder?.shipmentPackageId ?? invoice.shipmentPackageId));
      addKey(trendYolKeys, orderNumberKey(invoice.matchedOrder?.orderNumber ?? invoice.orderNumber));
    }
    if (trendYolKeys.size === 0) return { updated: 0 };

    const today = istanbulDayWindow();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        invoiceDate: {
          gte: today.start,
          lt: today.end
        }
      },
      include: { draft: { include: { order: true } } },
      take: 5000
    });
    let updated = 0;
    for (const invoice of invoices as any[]) {
      const alreadyDone =
        invoice.status === InvoiceStatus.TRENDYOL_SENT ||
        invoice.trendyolStatus === "SENT" ||
        invoice.trendyolStatus === "ALREADY_SENT" ||
        invoice.trendyolStatus === "MANUAL_DETECTED";
      if (alreadyDone) continue;

      const invoiceKeys = new Set<string>();
      addKey(invoiceKeys, orderPackageKey(invoice.draft?.order?.shipmentPackageId));
      addKey(invoiceKeys, orderNumberKey(invoice.draft?.order?.orderNumber));
      const matched = Array.from(invoiceKeys).some((key) => trendYolKeys.has(key));
      if (!matched) continue;

      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.TRENDYOL_SENT,
          trendyolStatus: "MANUAL_DETECTED",
          trendyolSentAt: new Date(),
          error: null
        }
      });
      updated += 1;

      const externalInvoice = (trendYolInvoices as any[]).find((candidate) => {
        const keys = new Set<string>();
        addKey(keys, orderPackageKey(candidate.matchedOrder?.shipmentPackageId ?? candidate.shipmentPackageId));
        addKey(keys, orderNumberKey(candidate.matchedOrder?.orderNumber ?? candidate.orderNumber));
        return Array.from(keys).some((key) => invoiceKeys.has(key));
      });
      const event = eventFor({
        type: "trendyol_manual_detected",
        severity: "success",
        externalInvoiceId: externalInvoice?.id,
        invoiceNumber: invoice.invoiceNumber,
        orderNumber: invoice.draft?.order?.orderNumber,
        shipmentPackageId: invoice.draft?.order?.shipmentPackageId,
        draftId: invoice.draftId,
        message: `${invoice.invoiceNumber} icin Trendyol siparis verisinde manuel fatura izi bulundu.`,
        nextAction: invoice.pdfPath ? "Pazaryeri adimi tamam; PDF arsivi hazir." : "Pazaryeri adimi tamam; SAFA PDF arsivi resmi PDF bekliyor."
      });
      await this.writeFollowupAudit(event);
    }

    return { updated };
  }

  async promoteSignedGibInvoices(options: {
    externalInvoiceId?: string;
    externalInvoiceIds?: string[];
    autoSendTrendyol?: boolean;
    forcedPdfPath?: string;
    startDate?: string;
    endDate?: string;
  } = {}) {
    const dateWhere = invoiceDateWhere({ startDate: options.startDate, endDate: options.endDate });
    const externalInvoiceWhere = options.externalInvoiceId
      ? { id: options.externalInvoiceId }
      : options.externalInvoiceIds && options.externalInvoiceIds.length > 0
        ? { id: { in: options.externalInvoiceIds }, source: ExternalInvoiceSource.GIB_PORTAL, ...dateWhere }
        : { source: ExternalInvoiceSource.GIB_PORTAL, ...dateWhere };
    const [externalInvoices, drafts, existingInvoices] = await Promise.all([
      this.prisma.externalInvoice.findMany({
        where: externalInvoiceWhere,
        include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } },
        orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
        take: 5000
      }),
      this.prisma.invoiceDraft.findMany({
        include: { order: true, invoice: true },
        take: 5000
      }),
      this.prisma.invoice.findMany({ take: 5000 })
    ]);

    const draftByOrderId = new Map<string, PortalDraftMatchCandidate>();
    const draftByPortalUuid = new Map<string, PortalDraftMatchCandidate>();
    const invoiceByNumber = new Map<string, any>();
    const invoiceByProviderKey = new Map<string, any>();

    for (const draft of drafts as any[]) {
      const candidate: PortalDraftMatchCandidate = {
        id: draft.id,
        orderId: draft.orderId,
        orderNumber: draft.order?.orderNumber,
        shipmentPackageId: draft.order?.shipmentPackageId,
        status: draft.status,
        portalDraftUuid: draft.portalDraftUuid,
        portalDraftNumber: draft.portalDraftNumber,
        portalDraftStatus: draft.portalDraftStatus,
        invoice: draft.invoice
      };
      draftByOrderId.set(candidate.orderId, candidate);
      if (candidate.portalDraftUuid) {
        try {
          draftByPortalUuid.set(normalizePortalEttn(candidate.portalDraftUuid), candidate);
        } catch {
          draftByPortalUuid.set(candidate.portalDraftUuid, candidate);
        }
      }
    }

    for (const invoice of existingInvoices as any[]) {
      invoiceByNumber.set(invoice.invoiceNumber, invoice);
      if (invoice.provider === "gib-portal-manual") invoiceByProviderKey.set(invoice.providerInvoiceId, invoice);
    }

    const followup = emptyFollowup();
    followup.checkedCount = externalInvoices.length;

    for (const externalInvoice of externalInvoices as Array<ExternalInvoice & { matchedOrder?: { orderNumber: string; shipmentPackageId: string } | null }>) {
      const signedByPortal = isSignedGibInvoice(externalInvoice);
      const signedByUploadedOfficialPdf = Boolean(options.forcedPdfPath && options.externalInvoiceId && externalInvoice.source === ExternalInvoiceSource.GIB_PORTAL);
      if (!signedByPortal && !signedByUploadedOfficialPdf) {
        if (externalInvoice.source === ExternalInvoiceSource.GIB_PORTAL) {
          const event = eventFor({
            type: "signature_pending",
            severity: "info",
            externalInvoiceId: externalInvoice.id,
            invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
            orderNumber: externalInvoice.matchedOrder?.orderNumber ?? externalInvoice.orderNumber ?? undefined,
            shipmentPackageId: externalInvoice.matchedOrder?.shipmentPackageId ?? externalInvoice.shipmentPackageId ?? undefined,
            message: `${externalInvoice.invoiceNumber ?? externalInvoice.externalKey} henuz GIB portalda imzali gorunmuyor.`,
            nextAction: "Portalda imza atildiktan sonra sonraki otomatik ya da manuel kontrol kaydi yakalar."
          });
          followup.timelineEvents.push(event);
        }
        continue;
      }

      followup.signedFound += 1;

      const match = this.resolvePromotionDraft(externalInvoice, draftByPortalUuid, draftByOrderId);
      if (!match) {
        const suggestion = matchSuggestionFromRaw(externalInvoice.raw);
        const reason = suggestion
          ? `Guvenli otomatik eslesme yok; aday siparis ${suggestion.orderNumber ?? "-"} / paket ${suggestion.shipmentPackageId ?? "-"} (${suggestion.score ?? 0}).`
          : "Guvenli otomatik eslesme bulunamadi.";
        followup.needsManualMatch += 1;
        followup.unmatchedReasons.push({
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
          externalKey: externalInvoice.externalKey,
          reason,
          candidateOrderNumber: suggestion?.orderNumber,
          candidateShipmentPackageId: suggestion?.shipmentPackageId,
          score: suggestion?.score
        });
        const event = eventFor({
          type: "needs_manual_match",
          severity: "warning",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
          orderNumber: suggestion?.orderNumber,
          shipmentPackageId: suggestion?.shipmentPackageId,
          message: `${externalInvoice.invoiceNumber ?? externalInvoice.externalKey} imzali bulundu ama otomatik eslestirilmedi.`,
          nextAction: "Aday siparis dogruysa acik kayit uzerinden manuel eslestirin; eslesme sonrasi arsiv ve Trendyol takibi otomatik calisir.",
          metadata: { reason, score: suggestion?.score }
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      const signedEvent = eventFor({
        type: "signed_found",
        severity: "success",
        externalInvoiceId: externalInvoice.id,
        invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
        orderNumber: match.orderNumber,
        shipmentPackageId: match.shipmentPackageId,
        draftId: match.id,
        message: `${externalInvoice.invoiceNumber ?? externalInvoice.externalKey} GIB portalda imzali bulundu.`,
        nextAction: "SAFA arsive almayi ve PDF varsa Trendyol'a gondermeyi deneyecek."
      });
      followup.timelineEvents.push(signedEvent);
      await this.writeFollowupAudit(signedEvent);

      if (!externalInvoice.invoiceNumber || !externalInvoice.invoiceDate) {
        const reason = "Imzali kayitta fatura numarasi veya fatura tarihi eksik.";
        followup.needsManualMatch += 1;
        followup.unmatchedReasons.push({
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
          externalKey: externalInvoice.externalKey,
          reason
        });
        const event = eventFor({
          type: "needs_manual_match",
          severity: "warning",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber ?? undefined,
          orderNumber: match.orderNumber,
          shipmentPackageId: match.shipmentPackageId,
          draftId: match.id,
          message: `${externalInvoice.externalKey} imzali bulundu ama fatura no/tarih eksik.`,
          nextAction: "Portal listesindeki ham kaydi kontrol edin; fatura no ve tarih okununca tekrar kontrol edin.",
          metadata: { reason }
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      const existingForDraft = match.invoice ?? invoiceByProviderKey.get(externalInvoice.externalKey) ?? invoiceByNumber.get(externalInvoice.invoiceNumber);
      const isManualProvider = existingForDraft?.provider === "gib-portal-manual";
      if (existingForDraft && !isManualProvider) {
        const event = eventFor({
          type: "archived",
          severity: "info",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber,
          orderNumber: match.orderNumber,
          shipmentPackageId: match.shipmentPackageId,
          draftId: match.id,
          message: `${externalInvoice.invoiceNumber} icin SAFA'da farkli saglayici faturasi zaten var; cift arsiv olusturulmadi.`,
          nextAction: "Siparis/PDF arsivindeki mevcut fatura kaydini kontrol edin."
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      const uploadedPdfPath = this.uploadedPdfPath(externalInvoice);
      const shouldAcquirePdf = !options.forcedPdfPath && !existingForDraft?.pdfPath && !uploadedPdfPath;
      const downloadedPdfPath =
        shouldAcquirePdf && externalInvoice.pdfUrl ? await this.tryDownloadOfficialPdf(externalInvoice.invoiceNumber, externalInvoice.pdfUrl) : undefined;
      const portalPdf = shouldAcquirePdf && !downloadedPdfPath ? await this.tryDownloadPortalOfficialPdf(externalInvoice) : undefined;
      const pdfPath = options.forcedPdfPath ?? existingForDraft?.pdfPath ?? uploadedPdfPath ?? downloadedPdfPath ?? portalPdf?.pdfPath;
      const resolvedPdfUrl = portalPdf?.pdfUrl ?? externalInvoice.pdfUrl;

      if ((options.forcedPdfPath || downloadedPdfPath || portalPdf) && pdfPath && !uploadedPdfPath) {
        await this.prisma.externalInvoice.update({
          where: { id: externalInvoice.id },
          data: {
            raw: portalPdf
              ? mergeRawWithOfficialPdf(externalInvoice.raw, {
                  uploadedPdfPath: pdfPath,
                  pdfUrl: portalPdf.pdfUrl,
                  source: portalPdf.source,
                  raw: portalPdf.raw
                })
              : mergeRawWithUpload(externalInvoice.raw, pdfPath),
            ...(resolvedPdfUrl ? { pdfUrl: resolvedPdfUrl } : {})
          }
        });
        if (portalPdf) {
          const event = eventFor({
            type: "pdf_saved",
            severity: "success",
            externalInvoiceId: externalInvoice.id,
            invoiceNumber: externalInvoice.invoiceNumber,
            orderNumber: match.orderNumber,
            shipmentPackageId: match.shipmentPackageId,
            draftId: match.id,
            message: `${externalInvoice.invoiceNumber} resmi PDF GIB portalindan alindi ve SAFA arsivine yazildi.`,
            nextAction: "PDF bulundu; Trendyol dosya gonderimi kontrol ediliyor.",
            metadata: { source: portalPdf.source, pdfUrl: portalPdf.pdfUrl }
          });
          followup.timelineEvents.push(event);
          await this.writeFollowupAudit(event);
        }
      }

      const invoice =
        existingForDraft ??
        (await this.prisma.invoice.create({
          data: {
            draftId: match.id,
            provider: "gib-portal-manual",
            providerInvoiceId: externalInvoice.externalKey,
            invoiceNumber: externalInvoice.invoiceNumber,
            invoiceDate: externalInvoice.invoiceDate,
            status: InvoiceStatus.ISSUED,
            pdfPath,
            pdfUrl: resolvedPdfUrl,
            error: pdfPath ? null : "Resmi e-Arsiv PDF bekliyor; Trendyol'a gonderilmedi."
          }
        }));

      const signedPortalStatus = externalInvoice.status ?? "Imzalandi";

      if (!existingForDraft) {
        followup.promoted += 1;
        invoiceByNumber.set(invoice.invoiceNumber, invoice);
        invoiceByProviderKey.set(externalInvoice.externalKey, invoice);
        await this.prisma.invoiceDraft.update({
          where: { id: match.id },
          data: {
            status: DraftStatus.ISSUED,
            portalDraftStatus: signedPortalStatus
          }
        });
        await this.prisma.auditLog.create({
          data: {
            action: "external-invoice.gib.promote",
            subjectType: "externalInvoice",
            subjectId: externalInvoice.id,
            message: `${externalInvoice.invoiceNumber} numarali manuel e-Arsiv faturasi SAFA arsivine alindi.`,
            metadata: json({
              externalInvoiceId: externalInvoice.id,
              invoiceId: invoice.id,
              draftId: match.id,
              orderNumber: match.orderNumber,
              shipmentPackageId: match.shipmentPackageId
            })
          }
        });
        const archivedEvent = eventFor({
          type: "archived",
          severity: "success",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber,
          orderNumber: match.orderNumber,
          shipmentPackageId: match.shipmentPackageId,
          draftId: match.id,
          message: `${externalInvoice.invoiceNumber} SAFA PDF arsivine fatura kaydi olarak alindi.`,
          nextAction: pdfPath ? "PDF bulundu; Trendyol gonderimi kontrol ediliyor." : "Resmi PDF bekleniyor; PDF gelmeden Trendyol'a dosya gonderilmeyecek."
        });
        followup.timelineEvents.push(archivedEvent);
        await this.writeFollowupAudit(archivedEvent);
      } else {
        if (match.status !== DraftStatus.ISSUED || match.portalDraftStatus !== signedPortalStatus) {
          await this.prisma.invoiceDraft.update({
            where: { id: match.id },
            data: {
              status: DraftStatus.ISSUED,
              portalDraftStatus: signedPortalStatus
            }
          });
        }

        if (pdfPath && !existingForDraft.pdfPath) {
          await this.prisma.invoice.update({
            where: { id: existingForDraft.id },
            data: { pdfPath, pdfUrl: resolvedPdfUrl, error: null }
          });
        }
      }

      const currentPdfPath = pdfPath ?? invoice.pdfPath;
      if (!currentPdfPath) {
        followup.pdfMissing += 1;
        const event = eventFor({
          type: "pdf_missing",
          severity: "warning",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber,
          orderNumber: match.orderNumber,
          shipmentPackageId: match.shipmentPackageId,
          draftId: match.id,
          message: `${externalInvoice.invoiceNumber} imzali ve arsivde; resmi PDF henuz yok, Trendyol'a gonderilmedi.`,
          nextAction: "GIB portal resmi PDF baglantisi gelince otomatik kontrol veya manuel PDF yukleme sonrasi Trendyol gonderimi calisir."
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      if (!options.autoSendTrendyol) continue;
      if (invoice.trendyolStatus === "SENT" || invoice.trendyolStatus === "ALREADY_SENT") {
        followup.trendyolAlreadySent += 1;
        const event = eventFor({
          type: "trendyol_sent",
          severity: "success",
          externalInvoiceId: externalInvoice.id,
          invoiceNumber: externalInvoice.invoiceNumber,
          orderNumber: match.orderNumber,
          shipmentPackageId: match.shipmentPackageId,
          draftId: match.id,
          message: `${externalInvoice.invoiceNumber} Trendyol'a daha once gonderilmis gorunuyor.`,
          nextAction: "Ek islem gerekmiyor."
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      const sendResult = await this.sendPromotedInvoiceToTrendyol({
        id: invoice.id,
        shipmentPackageId: match.shipmentPackageId,
        invoiceNumber: externalInvoice.invoiceNumber,
        invoiceDate: externalInvoice.invoiceDate,
        pdfPath: currentPdfPath
      });

      if (sendResult === "sent") followup.trendyolSent += 1;
      if (sendResult === "already_sent") followup.trendyolAlreadySent += 1;
      if (sendResult === "failed") followup.trendyolFailed += 1;
      const event = eventFor({
        type: sendResult === "failed" ? "trendyol_failed" : "trendyol_sent",
        severity: sendResult === "failed" ? "danger" : "success",
        externalInvoiceId: externalInvoice.id,
        invoiceNumber: externalInvoice.invoiceNumber,
        orderNumber: match.orderNumber,
        shipmentPackageId: match.shipmentPackageId,
        draftId: match.id,
        message:
          sendResult === "sent"
            ? `${externalInvoice.invoiceNumber} PDF dosyasi Trendyol'a gonderildi.`
            : sendResult === "already_sent"
              ? `${externalInvoice.invoiceNumber} Trendyol'da zaten kayitli.`
              : `${externalInvoice.invoiceNumber} Trendyol'a gonderilemedi.`,
        nextAction: sendResult === "failed" ? "Trendyol hata detayini arsiv satirinda kontrol edip yeniden gonderin." : "Ek islem gerekmiyor."
      });
      followup.timelineEvents.push(event);
      await this.writeFollowupAudit(event);
    }

    return resultWithFollowup({ imported: 0, matched: 0, unmatched: followup.needsManualMatch, invoices: await this.list(ExternalInvoiceSource.GIB_PORTAL) }, followup);
  }

  async reconcile(source?: ExternalInvoiceSource, options: { externalInvoiceIds?: string[] } = {}) {
    const where =
      options.externalInvoiceIds && options.externalInvoiceIds.length > 0
        ? { ...(source ? { source } : {}), id: { in: options.externalInvoiceIds } }
        : source
          ? { source }
          : undefined;
    const [externalInvoices, orders] = await Promise.all([
      this.prisma.externalInvoice.findMany({ where }),
      this.prisma.order.findMany({
        select: {
          id: true,
          shipmentPackageId: true,
          orderNumber: true,
          customerName: true,
          customerIdentifier: true,
          totalPayableCents: true,
          lastModifiedAt: true
        },
        take: 5000
      })
    ]);

    let matched = 0;
    let unmatched = 0;
    const context: MatchContext = {
      orderBuyerNameCounts: new Map<string, number>(),
      externalBuyerNameCounts: new Map<string, number>()
    };

    for (const order of orders) incrementCount(context.orderBuyerNameCounts, order.customerName);
    for (const invoice of externalInvoices) incrementCount(context.externalBuyerNameCounts, invoice.buyerName);

    for (const invoice of externalInvoices) {
      const match = this.findMatch(invoice, orders, context);

      if (match?.autoApply) {
        matched += 1;
        await this.prisma.externalInvoice.update({
          where: { id: invoice.id },
          data: {
            matchedOrderId: match.order.id,
            matchScore: match.score,
            matchReason: match.reason
          }
        });
      } else if (match) {
        unmatched += 1;
        await this.prisma.externalInvoice.update({
          where: { id: invoice.id },
          data: {
            matchedOrderId: null,
            matchScore: match.score,
            matchReason: `Otomatik uygulanmadi: ${match.reason}`,
            raw: mergeRawWithMatchSuggestion(invoice.raw, match)
          }
        });
      } else {
        unmatched += 1;
        await this.prisma.externalInvoice.update({
          where: { id: invoice.id },
          data: {
            matchedOrderId: null,
            matchScore: 0,
            matchReason: null
          }
        });
      }
    }

    return {
      matched,
      unmatched,
      invoices: options.externalInvoiceIds ? [] : await this.list(source)
    };
  }

  async manualMatch(
    externalInvoiceId: string,
    target: { orderId?: string; orderNumber?: string; shipmentPackageId?: string }
  ) {
    const invoice = await this.prisma.externalInvoice.findUnique({ where: { id: externalInvoiceId } });
    if (!invoice) throw new NotFoundException("Harici fatura bulunamadi.");

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          target.orderId ? { id: target.orderId } : undefined,
          target.orderNumber ? { orderNumber: target.orderNumber.trim() } : undefined,
          target.shipmentPackageId ? { shipmentPackageId: target.shipmentPackageId.trim() } : undefined
        ].filter(Boolean) as Prisma.OrderWhereInput[]
      }
    });

    if (!order) {
      throw new NotFoundException("Eslestirilecek siparis bulunamadi. Siparis no veya paket noyu kontrol edin.");
    }

    const updated = await this.prisma.externalInvoice.update({
      where: { id: externalInvoiceId },
      data: {
        matchedOrderId: order.id,
        matchScore: 100,
        matchReason: "Kullanici tarafindan manuel eslestirildi."
      },
      include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } }
    });

    await this.promoteSignedGibInvoices({ externalInvoiceId, autoSendTrendyol: true });

    return mapExternalInvoice(updated);
  }

  async clearMatch(externalInvoiceId: string) {
    const updated = await this.prisma.externalInvoice.update({
      where: { id: externalInvoiceId },
      data: {
        matchedOrderId: null,
        matchScore: 0,
        matchReason: null
      },
      include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } }
    });

    return mapExternalInvoice(updated);
  }

  private async repairMissingPortalDrafts(input: { start: Date; end: Date; mode: GibPortalSyncMode; orderNumber?: string }) {
    const followup = emptyFollowup();
    const orders = await this.prisma.order.findMany({
      include: {
        invoiceDraft: { include: { invoice: true } },
        externalInvoices: true
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 5000
    });

    const targetOrderNumber = input.orderNumber?.trim();
    const candidates = (orders as any[]).filter((order) => {
      if (targetOrderNumber && order.orderNumber !== targetOrderNumber) return false;
      if (targetOrderNumber) return true;
      const deliveredAt = extractTrendyolDeliveryDate(order.raw) ?? (order.status?.toLocaleLowerCase("tr-TR") === "delivered" ? order.lastModifiedAt : undefined);
      return (
        isDateInRange(deliveredAt, input.start, input.end) ||
        isDateInRange(order.lastModifiedAt, input.start, input.end) ||
        isDateInRange(order.createdAt, input.start, input.end) ||
        isDateInRange(order.updatedAt, input.start, input.end)
      );
    });

    followup.checkedCount = candidates.length;

    if (targetOrderNumber && candidates.length !== 1) {
      const reason =
        candidates.length === 0
          ? `${targetOrderNumber} siparisi SAFA verisinde bulunamadi.`
          : `${targetOrderNumber} icin birden fazla siparis bulundu; otomatik onarim uygulanmadi.`;
      followup.needsManualMatch += 1;
      followup.unmatchedReasons.push({ reason, candidateOrderNumber: targetOrderNumber });
      followup.timelineEvents.push(
        eventFor({
          type: "needs_manual_match",
          severity: "warning",
          orderNumber: targetOrderNumber,
          message: reason,
          nextAction: "Siparis kaydi netlesince 20 Mayis onarimini tekrar calistirin.",
          metadata: { mode: input.mode, repairMissingDrafts: true }
        })
      );
      return followup;
    }

    for (const order of candidates) {
      if (order.invoiceDraft?.invoice) {
        followup.timelineEvents.push(
          eventFor({
            type: "archived",
            severity: "info",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            draftId: order.invoiceDraft.id,
            invoiceNumber: order.invoiceDraft.invoice.invoiceNumber,
            message: `${order.orderNumber} icin SAFA arsiv faturasi zaten var; 20 Mayis onarimi atlandi.`,
            nextAction: "Ek islem gerekmiyor.",
            metadata: { mode: input.mode, repairMissingDrafts: true }
          })
        );
        continue;
      }

      if (order.invoiceDraft) {
        followup.timelineEvents.push(
          eventFor({
            type: order.invoiceDraft.portalDraftUuid || order.invoiceDraft.status === DraftStatus.PORTAL_DRAFTED ? "portal_uploaded" : "signature_pending",
            severity: "info",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            draftId: order.invoiceDraft.id,
            message:
              order.invoiceDraft.portalDraftUuid || order.invoiceDraft.status === DraftStatus.PORTAL_DRAFTED
                ? `${order.orderNumber} icin GIB portal taslagi zaten yuklenmis.`
                : `${order.orderNumber} icin SAFA taslagi zaten var; eksik taslak onarimi uygulanmadi.`,
            nextAction: "Imza takip kontrolu imzali faturayi yakalamayi deneyecek.",
            metadata: { mode: input.mode, repairMissingDrafts: true }
          })
        );
        continue;
      }

      if (order.externalInvoices?.length > 0) {
        followup.needsManualMatch += 1;
        const reason = `${order.orderNumber} icin harici fatura kaydi bulundu; duplicate riski nedeniyle yeni taslak olusturulmadi.`;
        followup.unmatchedReasons.push({
          reason,
          candidateOrderNumber: order.orderNumber,
          candidateShipmentPackageId: order.shipmentPackageId
        });
        followup.timelineEvents.push(
          eventFor({
            type: "needs_manual_match",
            severity: "warning",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            message: reason,
            nextAction: "Acik harici fatura kaydini eslestirin veya fatura izini manuel kontrol edin.",
            metadata: { mode: input.mode, repairMissingDrafts: true }
          })
        );
        continue;
      }

      const invoiceSignal = orderInvoiceSignal(order.raw);
      if (invoiceSignal) {
        followup.needsManualMatch += 1;
        const reason = `${order.orderNumber} Trendyol verisinde faturali gorunuyor; tekrar GIB taslagi olusturulmadi.`;
        followup.unmatchedReasons.push({
          reason,
          candidateOrderNumber: order.orderNumber,
          candidateShipmentPackageId: order.shipmentPackageId
        });
        followup.timelineEvents.push(
          eventFor({
            type: "needs_manual_match",
            severity: "warning",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            message: reason,
            nextAction: "Trendyol fatura izini kontrol edin; gerekiyorsa manuel eslestirme yapin.",
            metadata: { mode: input.mode, repairMissingDrafts: true, invoiceSignal }
          })
        );
        continue;
      }

      const normalizedOrder = storedOrderToNormalized(order);
      const draft = buildDraft(normalizedOrder);
      const draftStatus = draft.status === "READY" ? DraftStatus.READY : DraftStatus.NEEDS_REVIEW;
      const validationErrors = draft.validation.errors ?? [];

      if (validationErrors.length > 0) {
        followup.needsManualMatch += 1;
        const reason = `${order.orderNumber} icin taslak olusabilir ama hata var: ${validationErrors.join(", ")}`;
        followup.unmatchedReasons.push({
          reason,
          candidateOrderNumber: order.orderNumber,
          candidateShipmentPackageId: order.shipmentPackageId
        });
        followup.timelineEvents.push(
          eventFor({
            type: "needs_manual_match",
            severity: "warning",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            message: reason,
            nextAction: "Adres/urun/tutar eksigi duzeltilince taslak tekrar olusturulabilir.",
            metadata: { mode: input.mode, repairMissingDrafts: true, validationErrors }
          })
        );
        continue;
      }

      if (input.mode === "preview") {
        followup.timelineEvents.push(
          eventFor({
            type: "signature_pending",
            severity: "warning",
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            message: `${order.orderNumber} icin SAFA taslagi hic olusmamis; guvenli uygulama taslak olusturup GIB portalina yuklemeyi dener.`,
            nextAction: "Guvenli olanlari uygula ile yalnizca 20 Mayis kapsami icinde onarilir.",
            metadata: { mode: input.mode, repairMissingDrafts: true }
          })
        );
        continue;
      }

      const createdDraft = await this.prisma.invoiceDraft.create({
        data: {
          orderId: order.id,
          status: DraftStatus.ISSUING,
          validation: json(draft.validation),
          lines: json(draft.lines),
          totals: json(draft.totals),
          approvedAt: new Date()
        }
      });

      await this.prisma.auditLog.create({
        data: {
          action: "invoice-draft.repair.create",
          subjectType: "invoiceDraft",
          subjectId: createdDraft.id,
          message: `${order.orderNumber} icin 20 Mayis onarimi SAFA taslagi olusturdu.`,
          metadata: json({
            orderNumber: order.orderNumber,
            shipmentPackageId: order.shipmentPackageId,
            repairDate: "2026-05-20"
          })
        }
      });

      const payload = buildGibPortalInvoiceDraftPayload(providerPayloadFromDraft(normalizedOrder, draft));
      let uploadResult: Awaited<ReturnType<EarsivPortalService["createInvoiceDrafts"]>>[number] | undefined;
      try {
        [uploadResult] = await this.earsivPortal.createInvoiceDrafts([{ localDraftId: createdDraft.id, payload }]);
      } catch (error) {
        uploadResult = {
          localDraftId: createdDraft.id,
          ok: false,
          status: "YUKLEME_HATASI",
          command: "EARSIV_PORTAL_FATURA_OLUSTUR",
          pageName: "RG_BASITFATURA",
          error: error instanceof Error ? error.message : "GIB portal taslagi yuklenemedi."
        };
      }

      if (uploadResult?.ok) {
        const updatedDraft = await this.prisma.invoiceDraft.update({
          where: { id: createdDraft.id },
          data: {
            status: DraftStatus.PORTAL_DRAFTED,
            portalDraftUuid: uploadResult.uuid,
            portalDraftNumber: uploadResult.documentNumber,
            portalDraftUploadedAt: new Date(),
            portalDraftStatus: uploadResult.status ?? "Onaylanmadı",
            portalDraftResponse: json({
              command: uploadResult.command,
              pageName: uploadResult.pageName,
              message: uploadResult.message,
              response: uploadResult.response,
              repairDate: "2026-05-20"
            })
          }
        });
        const event = eventFor({
          type: "portal_uploaded",
          severity: "success",
          orderNumber: order.orderNumber,
          shipmentPackageId: order.shipmentPackageId,
          draftId: updatedDraft.id,
          message: `${order.orderNumber} icin eksik SAFA taslagi olusturuldu ve GIB portalina yuklendi.`,
          nextAction: "Portalda manuel imza bekleniyor; imza sonrasi otomatik takip arsiv/Trendyol adimini calistirir.",
          metadata: { mode: input.mode, repairMissingDrafts: true, portalDraftUuid: uploadResult.uuid }
        });
        followup.timelineEvents.push(event);
        await this.writeFollowupAudit(event);
        continue;
      }

      const error = uploadResult?.error ?? uploadResult?.message ?? "GIB portal taslagi yuklenemedi.";
      await this.prisma.invoiceDraft.update({
        where: { id: createdDraft.id },
        data: {
          status: draftStatus,
          portalDraftStatus: "YUKLEME_HATASI",
          portalDraftResponse: json({
            command: uploadResult?.command,
            pageName: uploadResult?.pageName,
            error,
            response: uploadResult?.response,
            repairDate: "2026-05-20"
          })
        }
      });
      followup.needsManualMatch += 1;
      const event = eventFor({
        type: "needs_manual_match",
        severity: "warning",
        orderNumber: order.orderNumber,
        shipmentPackageId: order.shipmentPackageId,
        draftId: createdDraft.id,
        message: `${order.orderNumber} icin SAFA taslagi olustu ama GIB portalina yuklenemedi.`,
        nextAction: "GIB portal oturumu duzeldikten sonra taslagi manuel GIB portalina yukleyin.",
        metadata: { mode: input.mode, repairMissingDrafts: true, error }
      });
      followup.timelineEvents.push(event);
      await this.writeFollowupAudit(event);
    }

    return followup;
  }

  private async previewGibPortalRecords(records: NormalizedExternalInvoice[]) {
    const followup = emptyFollowup();
    followup.checkedCount = records.length;

    const orders = await this.prisma.order.findMany({
      select: {
        id: true,
        shipmentPackageId: true,
        orderNumber: true,
        customerName: true,
        customerIdentifier: true,
        totalPayableCents: true,
        lastModifiedAt: true
      },
      take: 5000
    });

    const context: MatchContext = {
      orderBuyerNameCounts: new Map<string, number>(),
      externalBuyerNameCounts: new Map<string, number>()
    };
    for (const order of orders) incrementCount(context.orderBuyerNameCounts, order.customerName);
    for (const invoice of records) incrementCount(context.externalBuyerNameCounts, invoice.buyerName);

    let matched = 0;
    let unmatched = 0;

    for (const record of records) {
      const signed = isSignedGibInvoice(record);
      const match = this.findMatch(record, orders, context);

      if (match?.autoApply) {
        matched += 1;
      } else {
        unmatched += 1;
      }

      if (!signed) {
        followup.timelineEvents.push(
          eventFor({
            type: "signature_pending",
            severity: "info",
            invoiceNumber: record.invoiceNumber,
            orderNumber: match?.order.orderNumber ?? record.orderNumber,
            shipmentPackageId: match?.order.shipmentPackageId ?? record.shipmentPackageId,
            message: `${record.invoiceNumber ?? record.externalKey} GIB portal sorgusunda henuz imzali fatura gibi gorunmuyor.`,
            nextAction: "Portalda imza atildiktan sonra tekrar kontrol edin."
          })
        );
        continue;
      }

      followup.signedFound += 1;

      if (match?.autoApply) {
        followup.timelineEvents.push(
          eventFor({
            type: "signed_found",
            severity: "success",
            invoiceNumber: record.invoiceNumber,
            orderNumber: match.order.orderNumber,
            shipmentPackageId: match.order.shipmentPackageId,
            message: `${record.invoiceNumber ?? record.externalKey} imzali bulundu; ${match.reason}`,
            nextAction: "Guvenli olanlari uygula derseniz SAFA arsive alir, PDF varsa Trendyol'a gonderir.",
            metadata: { score: match.score, mode: "preview" }
          })
        );

        if (!record.pdfUrl && !this.uploadedPdfPath(record as unknown as ExternalInvoice)) {
          followup.pdfMissing += 1;
          followup.timelineEvents.push(
            eventFor({
              type: "pdf_missing",
              severity: "warning",
              invoiceNumber: record.invoiceNumber,
              orderNumber: match.order.orderNumber,
              shipmentPackageId: match.order.shipmentPackageId,
              message: `${record.invoiceNumber ?? record.externalKey} imzali ama preview kaydinda resmi PDF yolu bulunmadi.`,
              nextAction: "Apply sonrasi PDF bulunamazsa SAFA arsive alir fakat Trendyol'a gondermez."
            })
          );
        }
        continue;
      }

      const reason = match
        ? `Guvenli otomatik kural degil: ${match.reason}`
        : "Siparis/paket/UUID veya VKN+tutar+tarih ile tek ve guvenli aday bulunamadi.";
      followup.needsManualMatch += 1;
      followup.unmatchedReasons.push({
        invoiceNumber: record.invoiceNumber,
        externalKey: record.externalKey,
        reason,
        candidateOrderNumber: match?.order.orderNumber,
        candidateShipmentPackageId: match?.order.shipmentPackageId,
        score: match?.score
      });
      followup.timelineEvents.push(
        eventFor({
          type: "needs_manual_match",
          severity: "warning",
          invoiceNumber: record.invoiceNumber,
          orderNumber: match?.order.orderNumber,
          shipmentPackageId: match?.order.shipmentPackageId,
          message: `${record.invoiceNumber ?? record.externalKey} imzali bulundu ama otomatik uygulanmayacak.`,
          nextAction: "Aday siparis dogruysa manuel eslestirin; belirsizse acik birakin.",
          metadata: { reason, score: match?.score, mode: "preview" }
        })
      );
    }

    return { matched, unmatched, followup };
  }

  private async writeFollowupAudit(event: GibPortalTimelineEvent) {
    await this.prisma.auditLog.create({
      data: {
        action: `external-invoice.gib.${event.type}`,
        subjectType: "externalInvoice",
        subjectId: event.externalInvoiceId ?? event.invoiceNumber ?? "gib-portal",
        message: event.message,
        metadata: json({
          ...event.metadata,
          type: event.type,
          severity: event.severity,
          invoiceNumber: event.invoiceNumber,
          orderNumber: event.orderNumber,
          shipmentPackageId: event.shipmentPackageId,
          draftId: event.draftId,
          nextAction: event.nextAction,
          at: event.at
        })
      }
    });
  }

  private portalQueryErrorEvent(error: unknown, context: { start: Date; end: Date; mode: GibPortalSyncMode }) {
    const rawMessage = error instanceof Error ? error.message : "e-Arsiv portal sorgusu basarisiz.";
    const normalized = normalizedStatusText(rawMessage);
    const concurrentSession = /birden fazla/.test(normalized) && /guvenli/.test(normalized);
    const tokenMissing = /token/.test(normalized) || /oturum/.test(normalized);
    const timeout = /timeout|zaman asimi|econnaborted|etimedout/.test(normalized);

    const message = concurrentSession
      ? "GIB aktif oturum cakisiyor; guvenli cikis gerekli."
      : tokenMissing
        ? "e-Arsiv portal oturum/token alinamadi; kontrol sonraki denemeye birakildi."
        : timeout
          ? "e-Arsiv portal sorgusu zaman asimina ugradi; fatura durumu basarisiz sayilmadi."
          : rawMessage;

    return eventFor({
      type: "needs_manual_match",
      severity: concurrentSession || tokenMissing ? "warning" : "danger",
      message,
      nextAction: concurrentSession
        ? "GIB portalinda Guvenli Cikis yapin; backend sonraki 10 dakikalik kontrolde tekrar dener."
        : "Backend/API veya portal erisimi duzeldiginde manuel kontrolu tekrar baslatin.",
      metadata: {
        startDate: context.start.toISOString(),
        endDate: context.end.toISOString(),
        mode: context.mode,
        rawMessage
      }
    });
  }

  private resolvePromotionDraft(
    invoice: ExternalInvoice,
    draftByPortalUuid: Map<string, PortalDraftMatchCandidate>,
    draftByOrderId: Map<string, PortalDraftMatchCandidate>
  ) {
    const uuid = extractExternalUuid(invoice);
    if (uuid) {
      const byUuid = draftByPortalUuid.get(uuid);
      if (byUuid) return byUuid;
    }

    if (invoice.matchedOrderId && invoice.matchScore >= 90) {
      return draftByOrderId.get(invoice.matchedOrderId);
    }

    return undefined;
  }

  private uploadedPdfPath(invoice: ExternalInvoice) {
    const raw = invoice.raw as RawRecord;
    const value = raw && typeof raw === "object" ? raw.uploadedPdfPath : undefined;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private async tryDownloadOfficialPdf(invoiceNumber: string, pdfUrl: string) {
    if (!isLikelyPdfUrl(pdfUrl)) return undefined;

    try {
      const target = new URL(pdfUrl, "https://earsivportal.efatura.gov.tr/");
      const response = await axios.get<ArrayBuffer>(target.toString(), {
        responseType: "arraybuffer",
        timeout: 30_000,
        maxContentLength: 10 * 1024 * 1024,
        validateStatus: () => true
      });

      if (response.status < 200 || response.status >= 300) return undefined;
      const buffer = Buffer.from(response.data);
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return undefined;
      return this.writeInvoicePdf(invoiceNumber, buffer);
    } catch {
      return undefined;
    }
  }

  private async tryDownloadPortalOfficialPdf(invoice: ExternalInvoice) {
    const downloader = (this.earsivPortal as unknown as {
      downloadIssuedInvoicePdf?: (input: {
        externalKey: string;
        invoiceNumber?: string | null;
        invoiceDate?: Date | null;
        pdfUrl?: string | null;
        raw?: Prisma.JsonValue;
      }) => Promise<{ buffer: Buffer; pdfUrl?: string; source?: string; raw?: unknown } | undefined>;
    }).downloadIssuedInvoicePdf;
    if (typeof downloader !== "function" || !invoice.invoiceNumber) return undefined;

    try {
      const result = await downloader.call(this.earsivPortal, {
        externalKey: invoice.externalKey,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        pdfUrl: invoice.pdfUrl,
        raw: invoice.raw
      });
      if (!result?.buffer?.length || result.buffer.length > 10 * 1024 * 1024) return undefined;
      const pdfPath = await this.writeInvoicePdf(invoice.invoiceNumber, result.buffer);
      return {
        pdfPath,
        pdfUrl: result.pdfUrl,
        source: result.source ?? "GIB_PORTAL_OFFICIAL_PDF",
        raw: result.raw
      };
    } catch {
      return undefined;
    }
  }

  private async writeInvoicePdf(invoiceNumber: string, pdf: Buffer) {
    const storageDir = process.env.STORAGE_DIR ?? "./storage";
    const absoluteDir = path.resolve(process.cwd(), storageDir, "invoices");
    await fs.mkdir(absoluteDir, { recursive: true });
    const filePath = path.join(absoluteDir, `${safeFileStem(invoiceNumber)}.pdf`);
    await fs.writeFile(filePath, pdf);
    return filePath;
  }

  private async sendPromotedInvoiceToTrendyol(input: {
    id: string;
    shipmentPackageId: string;
    invoiceNumber: string;
    invoiceDate: Date;
    pdfPath: string;
  }): Promise<"sent" | "already_sent" | "failed"> {
    try {
      const result = await this.trendyol.sendInvoiceFile({
        shipmentPackageId: input.shipmentPackageId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        pdfPath: input.pdfPath
      });
      const alreadySent = Boolean(result.alreadySent);
      await this.prisma.invoice.update({
        where: { id: input.id },
        data: {
          status: InvoiceStatus.TRENDYOL_SENT,
          trendyolStatus: alreadySent ? "ALREADY_SENT" : "SENT",
          trendyolSentAt: new Date(),
          error: null
        }
      });
      return alreadySent ? "already_sent" : "sent";
    } catch (error) {
      await this.prisma.invoice.update({
        where: { id: input.id },
        data: {
          status: InvoiceStatus.TRENDYOL_SEND_FAILED,
          trendyolStatus: "SEND_FAILED",
          error: error instanceof Error ? error.message : "Trendyol fatura gonderimi basarisiz."
        }
      });
      return "failed";
    }
  }

  private async promotedInvoiceMap() {
    const invoices = await this.prisma.invoice.findMany({
      where: { provider: "gib-portal-manual" },
      take: 5000
    });
    return new Map(
      (invoices as any[])
        .filter((invoice) => typeof invoice.providerInvoiceId === "string")
        .map((invoice) => [
          invoice.providerInvoiceId,
          {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            pdfPath: invoice.pdfPath
          }
        ])
    );
  }

  private async upsertNormalized(invoice: NormalizedExternalInvoice) {
    return this.prisma.externalInvoice.upsert({
      where: {
        source_externalKey: {
          source: invoice.source,
          externalKey: invoice.externalKey
        }
      },
      update: {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        buyerName: invoice.buyerName,
        buyerIdentifier: invoice.buyerIdentifier,
        orderNumber: invoice.orderNumber,
        shipmentPackageId: invoice.shipmentPackageId,
        totalPayableCents: invoice.totalPayableCents,
        currency: invoice.currency,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl,
        xmlUrl: invoice.xmlUrl,
        raw: json(invoice.raw)
      },
      create: {
        source: invoice.source,
        externalKey: invoice.externalKey,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        buyerName: invoice.buyerName,
        buyerIdentifier: invoice.buyerIdentifier,
        orderNumber: invoice.orderNumber,
        shipmentPackageId: invoice.shipmentPackageId,
        totalPayableCents: invoice.totalPayableCents,
        currency: invoice.currency,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl,
        xmlUrl: invoice.xmlUrl,
        raw: json(invoice.raw)
      }
    });
  }

  private findMatch(invoice: MatchableExternalInvoice, orders: OrderMatchCandidate[], context: MatchContext): OrderMatchResult | null {
    const byShipment = invoice.shipmentPackageId
      ? orders.find((order) => order.shipmentPackageId === invoice.shipmentPackageId)
      : undefined;
    if (byShipment) {
      return { order: byShipment, score: 100, reason: `${sourceLabel(invoice.source)} paket numarasi birebir eslesti.`, autoApply: true };
    }

    const byOrderNumber = invoice.orderNumber ? orders.find((order) => order.orderNumber === invoice.orderNumber) : undefined;
    if (byOrderNumber) {
      return { order: byOrderNumber, score: 95, reason: `${sourceLabel(invoice.source)} siparis numarasi birebir eslesti.`, autoApply: true };
    }

    const buyerIdentifier = digits(invoice.buyerIdentifier);
    if (buyerIdentifier && invoice.totalPayableCents !== undefined && invoice.totalPayableCents !== null) {
      const byIdentityAndTotal = orders.filter(
        (order) =>
          digits(order.customerIdentifier) === buyerIdentifier &&
          order.totalPayableCents === invoice.totalPayableCents &&
          isDateClose(order.lastModifiedAt, invoice.invoiceDate, 45)
      );
      if (byIdentityAndTotal.length === 1) {
        return { order: byIdentityAndTotal[0], score: 92, reason: "Teslim tarihine yakin tek guvenli siparis bulundu.", autoApply: true };
      }

      const weakIdentityAndTotal = orders.filter(
        (order) => digits(order.customerIdentifier) === buyerIdentifier && order.totalPayableCents === invoice.totalPayableCents
      );
      if (weakIdentityAndTotal.length === 1) {
        return {
          order: weakIdentityAndTotal[0],
          score: 88,
          reason: "Vergi/TCKN ve toplam tutar eslesti; tarih guvenli otomatik kuralina girmedi.",
          autoApply: false
        };
      }
    }

    if (buyerIdentifier) {
      const byIdentity = orders.filter((order) => digits(order.customerIdentifier) === buyerIdentifier);
      if (byIdentity.length === 1) {
        return { order: byIdentity[0], score: 72, reason: "Vergi/TCKN tek siparisle eslesti; tutar portal listesinde yok.", autoApply: false };
      }

      if (invoice.invoiceDate) {
        const sameBuyerNearDate = byIdentity.filter((order) => isDateClose(order.lastModifiedAt, invoice.invoiceDate, 45));
        if (sameBuyerNearDate.length === 1) {
          return {
            order: sameBuyerNearDate[0],
            score: 70,
            reason: "Vergi/TCKN ve tarih araligi tek siparisle eslesti; tutar portal listesinde yok.",
            autoApply: false
          };
        }
      }
    }

    if (invoice.buyerName && invoice.totalPayableCents !== undefined && invoice.totalPayableCents !== null) {
      const buyerName = normalizeText(invoice.buyerName);
      const byNameAndTotal = orders.find((order) => {
        const orderName = normalizeText(order.customerName);
        return order.totalPayableCents === invoice.totalPayableCents && (orderName.includes(buyerName) || buyerName.includes(orderName));
      });

      if (byNameAndTotal) {
        return { order: byNameAndTotal, score: 78, reason: "Alici adi ve toplam tutar eslesti.", autoApply: false };
      }
    }

    if (invoice.buyerName && invoice.invoiceDate) {
      const buyerName = normalizeText(invoice.buyerName);
      const buyerNameIsUnique =
        buyerName &&
        context.externalBuyerNameCounts.get(buyerName) === 1 &&
        context.orderBuyerNameCounts.get(buyerName) === 1;

      if (buyerNameIsUnique) {
        const byUniqueNameAndDate = orders.find(
          (order) => normalizeText(order.customerName) === buyerName && isDateClose(order.lastModifiedAt, invoice.invoiceDate, 14)
        );

        if (byUniqueNameAndDate) {
          return {
            order: byUniqueNameAndDate,
            score: 66,
            reason: "Alici adi ve tarih araligi tek kayitla eslesti; GIB ozetinde tutar veya siparis numarasi yok.",
            autoApply: false
          };
        }
      }
    }

    return null;
  }
}
