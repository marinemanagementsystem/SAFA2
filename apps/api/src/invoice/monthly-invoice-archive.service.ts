import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExternalInvoiceSource, Prisma } from "@prisma/client";
import archiver = require("archiver");
import axios from "axios";
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";

type RawRecord = Record<string, unknown>;
type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: { draft: { include: { order: true } } };
}>;
type ExternalInvoiceRecord = Prisma.ExternalInvoiceGetPayload<{
  include: { matchedOrder: true };
}>;

interface MonthlyInvoiceInput {
  year: number;
  month: number;
}

interface MonthlyInvoiceArchiveResult {
  year: number;
  month: number;
  invoiceCount: number;
  missingPdfCount: number;
  missingXmlCount: number;
  draftXmlAvailableCount: number;
  excelFileName: string;
  archiveFileName: string;
  archivePath: string;
  downloadUrl: string;
  generatedAt: string;
}

interface MonthlyTotals {
  payableCents?: number;
  vatCents?: number;
  taxExclusiveCents?: number;
}

interface ArchiveAsset {
  fileName: string;
  buffer: Buffer;
  source: string;
}

interface MonthlyInvoiceEntry {
  id: string;
  invoice?: InvoiceRecord;
  external?: ExternalInvoiceRecord;
  invoiceNumber: string;
  invoiceDate: Date;
  buyerName: string;
  buyerIdentifier?: string;
  currency: string;
  source: "invoice" | "external";
  sourceLabel: string;
  externalKey?: string;
  totals: MonthlyTotals;
}

interface ManifestEntry {
  invoiceNumber: string;
  invoiceDate: string;
  buyerName: string;
  buyerIdentifier?: string;
  source: string;
  provider?: string;
  externalKey?: string;
  payableCents?: number;
  vatCents?: number;
  taxExclusiveCents?: number;
  pdfIncluded: boolean;
  pdfMissing: boolean;
  pdfSource?: string;
  xmlIncluded: boolean;
  xmlMissing: boolean;
  xmlSource?: string;
  draftXmlAvailable: boolean;
  rawFile: string;
}

interface ArchiveManifest {
  generatedAt: string;
  year: number;
  month: number;
  invoiceCount: number;
  missingPdfCount: number;
  missingXmlCount: number;
  draftXmlAvailableCount: number;
  note: string;
  entries: ManifestEntry[];
}

const TRY_TIMEZONE_OFFSET_HOURS = 3;
const MAX_REPORT_ROWS = 20_000;
const ASSET_TIMEOUT_MS = 8_000;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

const rawFieldAliases = {
  vat: [
    "vatCents",
    "vatAmountCents",
    "kdvTutari",
    "hesaplananKdv",
    "hesaplananKDV",
    "toplamKdv",
    "toplamKDV",
    "taxAmount",
    "vatAmount"
  ],
  taxExclusive: [
    "taxExclusiveCents",
    "vergilerHaricTutar",
    "vergilerHaricToplamTutar",
    "malHizmetToplamTutari",
    "malHizmetTutari",
    "matrah",
    "taxExclusiveAmount",
    "taxableAmount"
  ],
  payable: ["totalPayableCents", "payableCents", "odenecekTutar", "vergilerDahilToplamTutar", "genelToplam", "toplamTutar"],
  xmlContent: ["officialXml", "officialUbl", "invoiceXml", "faturaXml", "ublXml", "xmlContent"],
  uploadedPdfPath: ["uploadedPdfPath", "pdfPath", "officialPdfPath"]
} satisfies Record<string, string[]>;

function normalizeKey(key: string) {
  return key.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]/gi, "");
}

function flattenRecord(value: unknown, target = new Map<string, unknown>()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return target;

  for (const [key, item] of Object.entries(value as RawRecord)) {
    target.set(normalizeKey(key), item);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      flattenRecord(item, target);
    }
  }

  return target;
}

function pickValue(flat: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = flat.get(normalizeKey(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {};
}

function asArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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

function centsFromRecord(record: RawRecord, aliases: string[]) {
  const flat = flattenRecord(record);
  const value = pickValue(flat, aliases);
  const key = aliases.find((alias) => flat.has(normalizeKey(alias)));
  return parseMoneyCents(value, key);
}

function monthCode({ year, month }: MonthlyInvoiceInput) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthRange({ year, month }: MonthlyInvoiceInput) {
  const start = new Date(Date.UTC(year, month - 1, 1, -TRY_TIMEZONE_OFFSET_HOURS, 0, 0));
  const end =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1, -TRY_TIMEZONE_OFFSET_HOURS, 0, 0))
      : new Date(Date.UTC(year, month, 1, -TRY_TIMEZONE_OFFSET_HOURS, 0, 0));
  return { start, end };
}

function isInMonth(value: Date | null | undefined, range: { start: Date; end: Date }) {
  return Boolean(value && value >= range.start && value < range.end);
}

function dateKey(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function normalizeText(value?: string | null) {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedStatusText(value?: string | null) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function isSignedGibInvoice(invoice: ExternalInvoiceRecord) {
  if (invoice.source !== ExternalInvoiceSource.GIB_PORTAL) return false;

  const statusText = normalizedStatusText(invoice.status);
  if (/iptal|silindi|hata|reddedildi/.test(statusText)) return false;
  if (/taslak|onaylanmadi|onay bekliyor|imza bekliyor/.test(statusText)) return false;

  const raw = asRecord(invoice.raw);
  const command = String(raw.kaynakKomut ?? raw.sourceCommand ?? "");
  const explicitSigned = /onaylandi|imzalandi|imzali|kesildi|duzenlendi|basarili/.test(statusText);
  const issuedCommand = /ADIMA_KESILEN|KESILEN|ONAYLI/i.test(command);

  return Boolean(invoice.invoiceNumber && invoice.invoiceDate && (explicitSigned || issuedCommand));
}

function safeFileStem(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "invoice";
}

function resolveStoredPath(value?: string | null) {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function isHttpUrl(value?: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function moneyValue(cents?: number) {
  return cents === undefined ? null : cents / 100;
}

function getRawXmlContent(record: RawRecord) {
  const flat = flattenRecord(record);
  const value = pickValue(flat, rawFieldAliases.xmlContent);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^<\?xml|^<Invoice|^<ubl:Invoice/i.test(trimmed)) return undefined;
  return trimmed;
}

function getUploadedPdfPath(record: RawRecord) {
  const flat = flattenRecord(record);
  const value = pickValue(flat, rawFieldAliases.uploadedPdfPath);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateMonthInput(input: MonthlyInvoiceInput): MonthlyInvoiceInput {
  const year = Number(input.year);
  const month = Number(input.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException("Gecersiz yil.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException("Gecersiz ay.");
  }
  return { year, month };
}

function storageDir() {
  return process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
}

@Injectable()
export class MonthlyInvoiceArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  excelFileName(input: MonthlyInvoiceInput) {
    return `safa-faturalar-${monthCode(input)}.xlsx`;
  }

  archiveFileName(input: MonthlyInvoiceInput) {
    return `safa-fatura-arsivi-${monthCode(input)}.zip`;
  }

  async buildMonthlyExcel(input: MonthlyInvoiceInput) {
    const normalized = validateMonthInput(input);
    const entries = await this.collectMonthlyEntries(normalized);
    return this.buildExcelBuffer(normalized, entries);
  }

  async createMonthlyArchive(input: MonthlyInvoiceInput): Promise<MonthlyInvoiceArchiveResult> {
    const normalized = validateMonthInput(input);
    const entries = await this.collectMonthlyEntries(normalized);
    const generatedAt = new Date().toISOString();
    const excelBuffer = await this.buildExcelBuffer(normalized, entries);
    const archiveDir = this.archiveDir(normalized);
    const excelFileName = this.excelFileName(normalized);
    const archiveFileName = this.archiveFileName(normalized);

    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(path.join(archiveDir, excelFileName), excelBuffer);

    const { zipBuffer, manifest } = await this.buildArchiveZip(normalized, entries, excelBuffer, generatedAt);
    await fs.writeFile(path.join(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(archiveDir, archiveFileName), zipBuffer);

    return {
      year: normalized.year,
      month: normalized.month,
      invoiceCount: entries.length,
      missingPdfCount: manifest.missingPdfCount,
      missingXmlCount: manifest.missingXmlCount,
      draftXmlAvailableCount: manifest.draftXmlAvailableCount,
      excelFileName,
      archiveFileName,
      archivePath: path.join(archiveDir, archiveFileName),
      downloadUrl: `/api/invoices/monthly-archives/${normalized.year}/${normalized.month}/download`,
      generatedAt
    };
  }

  async readMonthlyArchive(input: MonthlyInvoiceInput) {
    const normalized = validateMonthInput(input);
    const archivePath = path.join(this.archiveDir(normalized), this.archiveFileName(normalized));

    try {
      return await fs.readFile(archivePath);
    } catch {
      throw new NotFoundException("Bu ay icin aylik ZIP arsivi henuz olusturulmamis.");
    }
  }

  private archiveDir(input: MonthlyInvoiceInput) {
    return path.join(storageDir(), "monthly-archives", String(input.year), String(input.month).padStart(2, "0"));
  }

  private async collectMonthlyEntries(input: MonthlyInvoiceInput): Promise<MonthlyInvoiceEntry[]> {
    const range = monthRange(input);
    const invoices = await this.prisma.invoice.findMany({
      include: {
        draft: {
          include: {
            order: true
          }
        }
      },
      orderBy: { invoiceDate: "asc" },
      take: MAX_REPORT_ROWS
    });
    const externalInvoices = await this.prisma.externalInvoice.findMany({
      include: {
        matchedOrder: true
      },
      orderBy: { invoiceDate: "asc" },
      take: MAX_REPORT_ROWS
    });

    const externalByKey = new Map(externalInvoices.map((invoice) => [invoice.externalKey, invoice]));
    const externalByNumberDate = new Map<string, ExternalInvoiceRecord>();
    for (const external of externalInvoices) {
      if (external.invoiceNumber && external.invoiceDate) {
        externalByNumberDate.set(`${external.invoiceNumber}|${dateKey(external.invoiceDate)}`, external);
      }
    }

    const usedExternalIds = new Set<string>();
    const entries: MonthlyInvoiceEntry[] = [];

    for (const invoice of invoices) {
      if (!isInMonth(invoice.invoiceDate, range)) continue;

      const external =
        externalByKey.get(invoice.providerInvoiceId) ??
        externalByNumberDate.get(`${invoice.invoiceNumber}|${dateKey(invoice.invoiceDate)}`);
      if (external) usedExternalIds.add(external.id);
      entries.push(this.entryFromInvoice(invoice, external));
    }

    for (const external of externalInvoices) {
      if (usedExternalIds.has(external.id)) continue;
      if (!isInMonth(external.invoiceDate, range)) continue;
      if (!isSignedGibInvoice(external)) continue;
      entries.push(this.entryFromExternal(external));
    }

    return entries.sort((left, right) => {
      const dateDiff = left.invoiceDate.getTime() - right.invoiceDate.getTime();
      if (dateDiff !== 0) return dateDiff;
      return left.invoiceNumber.localeCompare(right.invoiceNumber, "tr-TR");
    });
  }

  private entryFromInvoice(invoice: InvoiceRecord, external?: ExternalInvoiceRecord): MonthlyInvoiceEntry {
    const order = invoice.draft.order;
    const totals = this.computeInvoiceTotals(invoice, external);

    return {
      id: `invoice:${invoice.id}`,
      invoice,
      external,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      buyerName: order.customerName || external?.buyerName || "",
      buyerIdentifier: order.customerIdentifier ?? external?.buyerIdentifier ?? undefined,
      currency: order.currency || external?.currency || "TRY",
      source: "invoice",
      sourceLabel: invoice.provider === "gib-portal-manual" ? "e-Arsiv manuel" : "SAFA",
      externalKey: external?.externalKey ?? invoice.providerInvoiceId,
      totals
    };
  }

  private entryFromExternal(external: ExternalInvoiceRecord): MonthlyInvoiceEntry {
    return {
      id: `external:${external.id}`,
      external,
      invoiceNumber: external.invoiceNumber ?? external.externalKey,
      invoiceDate: external.invoiceDate ?? external.createdAt,
      buyerName: external.buyerName ?? external.matchedOrder?.customerName ?? "",
      buyerIdentifier: external.buyerIdentifier ?? external.matchedOrder?.customerIdentifier ?? undefined,
      currency: external.currency || "TRY",
      source: "external",
      sourceLabel: "e-Arsiv Portal",
      externalKey: external.externalKey,
      totals: this.computeExternalTotals(external)
    };
  }

  private computeInvoiceTotals(invoice: InvoiceRecord, external?: ExternalInvoiceRecord): MonthlyTotals {
    const draftTotals = this.computeDraftTotals(invoice.draft);
    if (draftTotals.vatCents !== undefined || draftTotals.taxExclusiveCents !== undefined) return draftTotals;

    return {
      ...this.computeExternalTotals(external),
      payableCents: draftTotals.payableCents ?? this.computeExternalTotals(external).payableCents
    };
  }

  private computeDraftTotals(draft: InvoiceRecord["draft"]): MonthlyTotals {
    const lines = asArray(draft.lines);
    const totalsRecord = asRecord(draft.totals);
    const declaredPayable =
      parseMoneyCents(totalsRecord.payableCents, "payableCents") ??
      parseMoneyCents(totalsRecord.totalPayableCents, "totalPayableCents") ??
      parseMoneyCents(totalsRecord.payable) ??
      parseMoneyCents(totalsRecord.totalPayable) ??
      draft.order.totalPayableCents;

    let linePayableTotal = 0;
    let taxExclusiveTotal = 0;
    let vatTotal = 0;
    let hasVatBreakdown = false;

    for (const line of lines) {
      const payable =
        parseMoneyCents(line.payableCents, "payableCents") ??
        parseMoneyCents(line.totalPayableCents, "totalPayableCents") ??
        parseMoneyCents(line.payable) ??
        parseMoneyCents(line.total);
      const vatRate = numberValue(line.vatRate ?? line.kdvOrani ?? line.taxRate);
      if (payable === undefined || vatRate === undefined || vatRate < 0) continue;

      const taxExclusive = Math.round((payable * 100) / (100 + vatRate));
      linePayableTotal += payable;
      taxExclusiveTotal += taxExclusive;
      vatTotal += payable - taxExclusive;
      hasVatBreakdown = true;
    }

    if (!hasVatBreakdown) return { payableCents: declaredPayable };

    if (declaredPayable !== undefined && linePayableTotal > 0 && declaredPayable !== linePayableTotal) {
      taxExclusiveTotal = Math.round((taxExclusiveTotal * declaredPayable) / linePayableTotal);
      vatTotal = declaredPayable - taxExclusiveTotal;
    }

    return {
      payableCents: declaredPayable ?? linePayableTotal,
      vatCents: vatTotal,
      taxExclusiveCents: taxExclusiveTotal
    };
  }

  private computeExternalTotals(external?: ExternalInvoiceRecord): MonthlyTotals {
    if (!external) return {};

    const raw = asRecord(external.raw);
    return {
      payableCents: external.totalPayableCents ?? centsFromRecord(raw, rawFieldAliases.payable),
      vatCents: centsFromRecord(raw, rawFieldAliases.vat),
      taxExclusiveCents: centsFromRecord(raw, rawFieldAliases.taxExclusive)
    };
  }

  private async buildExcelBuffer(input: MonthlyInvoiceInput, entries: MonthlyInvoiceEntry[]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SAFA";
    workbook.created = new Date();
    workbook.modified = new Date();
    const sheet = workbook.addWorksheet("Faturalar");

    sheet.columns = [
      { header: "Fatura numarası", key: "invoiceNumber", width: 24 },
      { header: "Fatura tarihi", key: "invoiceDate", width: 16 },
      { header: "İsim Soyisim", key: "buyerName", width: 32 },
      { header: "TC ya da VKN", key: "buyerIdentifier", width: 18 },
      { header: "KDV tutarı", key: "vat", width: 16 },
      { header: "Ödenecek tutar", key: "payable", width: 18 },
      { header: "Vergiler hariç tutar", key: "taxExclusive", width: 20 }
    ];
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = "A1:G1";

    for (const entry of entries) {
      sheet.addRow({
        invoiceNumber: entry.invoiceNumber,
        invoiceDate: entry.invoiceDate,
        buyerName: entry.buyerName,
        buyerIdentifier: entry.buyerIdentifier ?? "",
        vat: moneyValue(entry.totals.vatCents),
        payable: moneyValue(entry.totals.payableCents),
        taxExclusive: moneyValue(entry.totals.taxExclusiveCents)
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.getColumn("invoiceDate").numFmt = "dd.mm.yyyy";
    for (const key of ["vat", "payable", "taxExclusive"]) {
      sheet.getColumn(key).numFmt = '#,##0.00 "TRY"';
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  }

  private async buildArchiveZip(
    input: MonthlyInvoiceInput,
    entries: MonthlyInvoiceEntry[],
    excelBuffer: Buffer,
    generatedAt: string
  ): Promise<{ zipBuffer: Buffer; manifest: ArchiveManifest }> {
    const manifestEntries: ManifestEntry[] = [];
    const zip = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    const streamPromise = new Promise<Buffer>((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      zip.on("error", reject);
    });

    zip.pipe(stream);
    zip.append(excelBuffer, { name: this.excelFileName(input) });

    for (const entry of entries) {
      const fileStem = safeFileStem(entry.invoiceNumber);
      const pdf = await this.resolvePdfAsset(entry, fileStem);
      const xml = await this.resolveOfficialXmlAsset(entry, fileStem);
      const rawFile = `raw/${fileStem}.json`;
      const draftXmlAvailable = Boolean(entry.invoice?.draft);

      const rawPayload = {
        source: entry.source,
        sourceLabel: entry.sourceLabel,
        invoice: entry.invoice ? this.invoiceRawSnapshot(entry.invoice) : undefined,
        externalInvoice: entry.external ? this.externalRawSnapshot(entry.external) : undefined
      };

      if (pdf) zip.append(pdf.buffer, { name: `pdf/${pdf.fileName}` });
      if (xml) zip.append(xml.buffer, { name: `xml/${xml.fileName}` });
      zip.append(JSON.stringify(rawPayload, null, 2), { name: rawFile });

      manifestEntries.push({
        invoiceNumber: entry.invoiceNumber,
        invoiceDate: entry.invoiceDate.toISOString(),
        buyerName: entry.buyerName,
        buyerIdentifier: entry.buyerIdentifier,
        source: entry.sourceLabel,
        provider: entry.invoice?.provider,
        externalKey: entry.externalKey,
        payableCents: entry.totals.payableCents,
        vatCents: entry.totals.vatCents,
        taxExclusiveCents: entry.totals.taxExclusiveCents,
        pdfIncluded: Boolean(pdf),
        pdfMissing: !pdf,
        pdfSource: pdf?.source,
        xmlIncluded: Boolean(xml),
        xmlMissing: !xml,
        xmlSource: xml?.source,
        draftXmlAvailable,
        rawFile
      });
    }

    const manifest: ArchiveManifest = {
      generatedAt,
      year: input.year,
      month: input.month,
      invoiceCount: entries.length,
      missingPdfCount: manifestEntries.filter((entry) => entry.pdfMissing).length,
      missingXmlCount: manifestEntries.filter((entry) => entry.xmlMissing).length,
      draftXmlAvailableCount: manifestEntries.filter((entry) => entry.draftXmlAvailable).length,
      note:
        "XML/UBL yalnizca resmi kaynakta bulunduysa eklenir. SAFA taslak XML'i resmi belge gibi ZIP'e eklenmez; yalnizca draftXmlAvailable alaninda isaretlenir.",
      entries: manifestEntries
    };

    zip.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    await zip.finalize();

    return { zipBuffer: await streamPromise, manifest };
  }

  private invoiceRawSnapshot(invoice: InvoiceRecord) {
    return {
      id: invoice.id,
      draftId: invoice.draftId,
      provider: invoice.provider,
      providerInvoiceId: invoice.providerInvoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString(),
      status: invoice.status,
      pdfPath: invoice.pdfPath,
      pdfUrl: invoice.pdfUrl,
      trendyolSentAt: invoice.trendyolSentAt?.toISOString(),
      trendyolStatus: invoice.trendyolStatus,
      order: {
        id: invoice.draft.order.id,
        orderNumber: invoice.draft.order.orderNumber,
        shipmentPackageId: invoice.draft.order.shipmentPackageId,
        customerName: invoice.draft.order.customerName,
        customerIdentifier: invoice.draft.order.customerIdentifier,
        totalPayableCents: invoice.draft.order.totalPayableCents,
        currency: invoice.draft.order.currency
      },
      draft: {
        id: invoice.draft.id,
        status: invoice.draft.status,
        lines: invoice.draft.lines,
        totals: invoice.draft.totals,
        portalDraftUuid: invoice.draft.portalDraftUuid,
        portalDraftNumber: invoice.draft.portalDraftNumber
      }
    };
  }

  private externalRawSnapshot(invoice: ExternalInvoiceRecord) {
    return {
      id: invoice.id,
      source: invoice.source,
      externalKey: invoice.externalKey,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate?.toISOString(),
      buyerName: invoice.buyerName,
      buyerIdentifier: invoice.buyerIdentifier,
      orderNumber: invoice.orderNumber,
      shipmentPackageId: invoice.shipmentPackageId,
      totalPayableCents: invoice.totalPayableCents,
      currency: invoice.currency,
      status: invoice.status,
      pdfUrl: invoice.pdfUrl,
      xmlUrl: invoice.xmlUrl,
      matchedOrderId: invoice.matchedOrderId,
      raw: invoice.raw
    };
  }

  private async resolvePdfAsset(entry: MonthlyInvoiceEntry, fileStem: string): Promise<ArchiveAsset | undefined> {
    const raw = asRecord(entry.external?.raw);
    const storedPath = resolveStoredPath(entry.invoice?.pdfPath ?? getUploadedPdfPath(raw));
    const storedBuffer = await this.readOptionalFile(storedPath);
    if (storedBuffer) {
      return { fileName: `${fileStem}.pdf`, buffer: storedBuffer, source: storedPath ?? "stored-pdf" };
    }

    const downloaded = await this.downloadOptionalAsset(entry.invoice?.pdfUrl ?? entry.external?.pdfUrl, "pdf");
    if (downloaded) {
      return { fileName: `${fileStem}.pdf`, buffer: downloaded, source: entry.invoice?.pdfUrl ?? entry.external?.pdfUrl ?? "remote-pdf" };
    }

    return undefined;
  }

  private async resolveOfficialXmlAsset(entry: MonthlyInvoiceEntry, fileStem: string): Promise<ArchiveAsset | undefined> {
    const rawXml = getRawXmlContent(asRecord(entry.external?.raw));
    if (rawXml) {
      return { fileName: `${fileStem}.xml`, buffer: Buffer.from(rawXml, "utf8"), source: "external-raw" };
    }

    const downloaded = await this.downloadOptionalAsset(entry.external?.xmlUrl, "xml");
    if (downloaded) {
      return { fileName: `${fileStem}.xml`, buffer: downloaded, source: entry.external?.xmlUrl ?? "remote-xml" };
    }

    return undefined;
  }

  private async readOptionalFile(filePath?: string) {
    if (!filePath) return undefined;
    try {
      return await fs.readFile(filePath);
    } catch {
      return undefined;
    }
  }

  private async downloadOptionalAsset(url?: string | null, kind?: "pdf" | "xml") {
    if (!url || !isHttpUrl(url)) return undefined;
    const assetUrl = url;

    try {
      const response = await axios.get(assetUrl, {
        responseType: "arraybuffer",
        timeout: ASSET_TIMEOUT_MS,
        maxContentLength: MAX_ASSET_BYTES,
        validateStatus: (status) => status >= 200 && status < 300
      });
      const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data as ArrayBuffer);
      if (kind === "pdf" && !buffer.subarray(0, 5).toString("utf8").startsWith("%PDF")) return undefined;
      if (kind === "xml" && !buffer.subarray(0, 200).toString("utf8").trimStart().startsWith("<")) return undefined;
      return buffer;
    } catch {
      return undefined;
    }
  }
}
