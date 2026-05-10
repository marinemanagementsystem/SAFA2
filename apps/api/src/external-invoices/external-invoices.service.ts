import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ExternalInvoice, ExternalInvoiceSource, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { EarsivPortalService } from "../earsiv-portal/earsiv-portal.service";
import { PrismaService } from "../prisma/prisma.service";

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

interface MatchContext {
  orderBuyerNameCounts: Map<string, number>;
  externalBuyerNameCounts: Map<string, number>;
}

const fieldAliases = {
  externalId: ["externalId", "id", "uuid", "ettn", "belgeOid", "faturaOid", "documentId"],
  invoiceNumber: ["invoiceNumber", "invoiceNo", "faturaNo", "faturaNumarasi", "belgeNo", "belgeNumarasi", "documentNumber", "seriSiraNo"],
  invoiceDate: ["invoiceDate", "faturaTarihi", "duzenlenmeTarihi", "belgeTarihi", "tarih", "issueDate", "date"],
  buyerName: ["buyerName", "alici", "aliciUnvan", "aliciUnvanAdSoyad", "unvan", "adSoyad", "musteri", "customerName"],
  buyerIdentifier: ["buyerIdentifier", "aliciVknTckn", "vknTckn", "vkn", "tckn", "vergiNo", "taxId"],
  orderNumber: ["orderNumber", "siparisNo", "siparisNumarasi", "orderNo", "merchantOrderNumber"],
  shipmentPackageId: ["shipmentPackageId", "paketNo", "paketNumarasi", "cargoTrackingNumber", "packageId"],
  total: ["totalPayableCents", "totalPayable", "payableAmount", "odenecekTutar", "genelToplam", "toplamTutar", "tutar"],
  currency: ["currency", "paraBirimi", "doviz", "currencyCode"],
  status: ["status", "durum", "belgeDurumu", "onayDurumu", "invoiceStatus"],
  pdfUrl: ["pdfUrl", "invoicePdfUrl", "faturaPdfUrl", "pdf", "downloadUrl"],
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
  return Boolean(record.invoiceNumber || record.pdfUrl || record.xmlUrl || record.raw.ettn || record.raw.uuid);
}

function mapExternalInvoice(
  invoice: ExternalInvoice & { matchedOrder?: { orderNumber: string; shipmentPackageId: string } | null }
) {
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
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

@Injectable()
export class ExternalInvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EarsivPortalService) private readonly earsivPortal: EarsivPortalService
  ) {}

  async list(source?: ExternalInvoiceSource) {
    const invoices = await this.prisma.externalInvoice.findMany({
      where: source ? { source } : undefined,
      include: { matchedOrder: { select: { orderNumber: true, shipmentPackageId: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: 5000
    });

    return invoices.map(mapExternalInvoice);
  }

  async importRecords(source: ExternalInvoiceSource, records: RawRecord[]) {
    let imported = 0;

    for (const record of records) {
      const normalized = normalizeRecord(source, record);
      await this.upsertNormalized(normalized);
      imported += 1;
    }

    const reconcile = await this.reconcile(source);
    return {
      imported,
      matched: reconcile.matched,
      unmatched: reconcile.unmatched,
      invoices: await this.list(source)
    };
  }

  async syncGibPortal(input: { days: number; startDate?: string; endDate?: string }) {
    const end = input.endDate ? parseDate(input.endDate) : new Date();
    const start = input.startDate ? parseDate(input.startDate) : new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
    if (!start || !end) throw new BadRequestException("e-Arsiv sorgu tarihleri okunamadi.");

    const records = await this.earsivPortal.listIssuedInvoices(start, end);
    if (records.length === 0) {
      await this.prisma.auditLog.create({
        data: {
          action: "external-invoice.sync.gib",
          subjectType: "external-invoice",
          subjectId: "gib-portal",
          message: "e-Arsiv portal sorgusu tamamlandi; bu aralikta fatura bulunamadi.",
          metadata: json({ startDate: start.toISOString(), endDate: end.toISOString(), count: 0 })
        }
      });
      return { imported: 0, matched: 0, unmatched: 0, invoices: await this.list(ExternalInvoiceSource.GIB_PORTAL) };
    }

    return this.importRecords(ExternalInvoiceSource.GIB_PORTAL, records);
  }

  async syncTrendyolMetadata() {
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
        invoices: await this.list(ExternalInvoiceSource.TRENDYOL)
      };
    }

    return this.importRecords(ExternalInvoiceSource.TRENDYOL, records);
  }

  async reconcile(source?: ExternalInvoiceSource) {
    const [externalInvoices, orders] = await Promise.all([
      this.prisma.externalInvoice.findMany({ where: source ? { source } : undefined }),
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

      if (match) {
        matched += 1;
        await this.prisma.externalInvoice.update({
          where: { id: invoice.id },
          data: {
            matchedOrderId: match.order.id,
            matchScore: match.score,
            matchReason: match.reason
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
      invoices: await this.list(source)
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

  private findMatch(invoice: ExternalInvoice, orders: OrderMatchCandidate[], context: MatchContext) {
    const byShipment = invoice.shipmentPackageId
      ? orders.find((order) => order.shipmentPackageId === invoice.shipmentPackageId)
      : undefined;
    if (byShipment) {
      return { order: byShipment, score: 100, reason: `${sourceLabel(invoice.source)} paket numarasi birebir eslesti.` };
    }

    const byOrderNumber = invoice.orderNumber ? orders.find((order) => order.orderNumber === invoice.orderNumber) : undefined;
    if (byOrderNumber) {
      return { order: byOrderNumber, score: 95, reason: `${sourceLabel(invoice.source)} siparis numarasi birebir eslesti.` };
    }

    const buyerIdentifier = digits(invoice.buyerIdentifier);
    if (buyerIdentifier && invoice.totalPayableCents !== null) {
      const byIdentityAndTotal = orders.find(
        (order) => digits(order.customerIdentifier) === buyerIdentifier && order.totalPayableCents === invoice.totalPayableCents
      );
      if (byIdentityAndTotal) {
        return { order: byIdentityAndTotal, score: 90, reason: "Vergi/TCKN ve toplam tutar eslesti." };
      }
    }

    if (buyerIdentifier) {
      const byIdentity = orders.filter((order) => digits(order.customerIdentifier) === buyerIdentifier);
      if (byIdentity.length === 1) {
        return { order: byIdentity[0], score: 72, reason: "Vergi/TCKN tek siparisle eslesti; tutar portal listesinde yok." };
      }

      if (invoice.invoiceDate) {
        const sameBuyerNearDate = byIdentity.filter((order) => isDateClose(order.lastModifiedAt, invoice.invoiceDate, 45));
        if (sameBuyerNearDate.length === 1) {
          return { order: sameBuyerNearDate[0], score: 70, reason: "Vergi/TCKN ve tarih araligi tek siparisle eslesti; tutar portal listesinde yok." };
        }
      }
    }

    if (invoice.buyerName && invoice.totalPayableCents !== null) {
      const buyerName = normalizeText(invoice.buyerName);
      const byNameAndTotal = orders.find((order) => {
        const orderName = normalizeText(order.customerName);
        return order.totalPayableCents === invoice.totalPayableCents && (orderName.includes(buyerName) || buyerName.includes(orderName));
      });

      if (byNameAndTotal) {
        return { order: byNameAndTotal, score: 78, reason: "Alici adi ve toplam tutar eslesti." };
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
            reason: "Alici adi ve tarih araligi tek kayitla eslesti; GIB ozetinde tutar veya siparis numarasi yok."
          };
        }
      }
    }

    return null;
  }
}
