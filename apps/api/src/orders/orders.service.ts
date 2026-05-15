import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DraftStatus, Prisma } from "@prisma/client";
import { ExternalInvoicesService } from "../external-invoices/external-invoices.service";
import { PrismaService } from "../prisma/prisma.service";
import { TrendyolService } from "../trendyol/trendyol.service";
import { extractTrendyolDeliveryDate, normalizeTrendyolPackage } from "../trendyol/trendyol-normalizer";
import { buildDraft } from "./invoice-draft-builder";

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function deliveredAtForOrder(raw: unknown, status: string, fallback?: Date | null) {
  return extractTrendyolDeliveryDate(raw) ?? (status.toLocaleLowerCase("tr-TR") === "delivered" ? fallback ?? undefined : undefined);
}

function deliveredSortTime(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function invoiceSourceLabel(provider?: string | null) {
  if (provider === "gib-portal-manual") return "e-Arsiv manuel";
  if (provider === "gib-direct") return "GIB direct";
  return "SAFA";
}

const refreshableDraftStatuses = new Set<DraftStatus>([
  DraftStatus.NEEDS_REVIEW,
  DraftStatus.READY,
  DraftStatus.APPROVED,
  DraftStatus.ERROR
]);

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toDraftStatus(status: "READY" | "NEEDS_REVIEW") {
  return status === "READY" ? DraftStatus.READY : DraftStatus.NEEDS_REVIEW;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrendyolService) private readonly trendyol: TrendyolService,
    @Inject(ExternalInvoicesService) private readonly externalInvoices: ExternalInvoicesService
  ) {}

  async listOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: [{ lastModifiedAt: "desc" }, { createdAt: "desc" }],
      include: {
        invoiceDraft: {
          include: { invoice: true }
        },
        externalInvoices: {
          orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
          take: 3
        },
        _count: { select: { externalInvoices: true } }
      },
      take: 500
    });

    return orders
      .map((order) => {
        const deliveredAt = deliveredAtForOrder(order.raw, order.status, order.lastModifiedAt);

        return {
          id: order.id,
          shipmentPackageId: order.shipmentPackageId,
          orderNumber: order.orderNumber,
          status: order.status,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          city: String((order.invoiceAddress as Prisma.JsonObject).city ?? ""),
          district: String((order.invoiceAddress as Prisma.JsonObject).district ?? ""),
          totalGrossCents: order.totalGrossCents,
          totalDiscountCents: order.totalDiscountCents,
          totalPayableCents: order.totalPayableCents,
          currency: order.currency,
          lastModifiedAt: order.lastModifiedAt?.toISOString(),
          deliveredAt: deliveredAt?.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          createdAt: order.createdAt.toISOString(),
          draftId: order.invoiceDraft?.id,
          draftStatus: order.invoiceDraft?.status,
          invoiceId: order.invoiceDraft?.invoice?.id,
          invoiceNumber: order.invoiceDraft?.invoice?.invoiceNumber,
          invoiceDate: order.invoiceDraft?.invoice?.invoiceDate.toISOString(),
          invoiceProvider: order.invoiceDraft?.invoice?.provider,
          invoiceSourceLabel: order.invoiceDraft?.invoice ? invoiceSourceLabel(order.invoiceDraft.invoice.provider) : undefined,
          invoicePdfAvailable: Boolean(order.invoiceDraft?.invoice?.pdfPath),
          trendyolStatus: order.invoiceDraft?.invoice?.trendyolStatus,
          externalInvoiceCount: order._count.externalInvoices,
          externalInvoiceSources: Array.from(new Set(order.externalInvoices.map((invoice: any) => invoice.source))),
          externalInvoiceNumber: order.externalInvoices[0]?.invoiceNumber ?? undefined,
          externalInvoiceDate: order.externalInvoices[0]?.invoiceDate?.toISOString()
        };
      })
      .sort(
        (left, right) =>
          deliveredSortTime(right.deliveredAt ?? right.lastModifiedAt ?? right.updatedAt) -
          deliveredSortTime(left.deliveredAt ?? left.lastModifiedAt ?? left.updatedAt)
      );
  }

  async getOrderDetail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        invoiceDraft: {
          include: { invoice: true }
        },
        externalInvoices: {
          orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }]
        }
      }
    });

    if (!order) throw new NotFoundException("Siparis bulunamadi.");

    const address = order.invoiceAddress as Prisma.JsonObject;
    const validation = order.invoiceDraft?.validation as { errors?: string[]; warnings?: string[] } | undefined;
    const lines = Array.isArray(order.invoiceDraft?.lines) ? order.invoiceDraft.lines : [];

    return {
      id: order.id,
      shipmentPackageId: order.shipmentPackageId,
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerIdentifier: order.customerIdentifier,
      invoiceAddress: address,
      raw: order.raw,
      totalGrossCents: order.totalGrossCents,
      totalDiscountCents: order.totalDiscountCents,
      totalPayableCents: order.totalPayableCents,
      currency: order.currency,
      lastModifiedAt: order.lastModifiedAt?.toISOString(),
      deliveredAt: deliveredAtForOrder(order.raw, order.status, order.lastModifiedAt)?.toISOString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      draft: order.invoiceDraft
        ? {
            id: order.invoiceDraft.id,
            documentType: order.invoiceDraft.documentType,
            status: order.invoiceDraft.status,
            warnings: validation?.warnings ?? [],
            errors: validation?.errors ?? [],
            lines,
            totals: order.invoiceDraft.totals,
            approvedAt: order.invoiceDraft.approvedAt?.toISOString(),
            portalDraftUuid: order.invoiceDraft.portalDraftUuid ?? undefined,
            portalDraftNumber: order.invoiceDraft.portalDraftNumber ?? undefined,
            portalDraftUploadedAt: order.invoiceDraft.portalDraftUploadedAt?.toISOString(),
            portalDraftStatus: order.invoiceDraft.portalDraftStatus ?? undefined,
            createdAt: order.invoiceDraft.createdAt.toISOString(),
            updatedAt: order.invoiceDraft.updatedAt.toISOString()
          }
        : null,
      invoice: order.invoiceDraft?.invoice
        ? {
            id: order.invoiceDraft.invoice.id,
            provider: order.invoiceDraft.invoice.provider,
            providerInvoiceId: order.invoiceDraft.invoice.providerInvoiceId,
            invoiceNumber: order.invoiceDraft.invoice.invoiceNumber,
            invoiceDate: order.invoiceDraft.invoice.invoiceDate.toISOString(),
            status: order.invoiceDraft.invoice.status,
            sourceLabel: invoiceSourceLabel(order.invoiceDraft.invoice.provider),
            pdfUrl: order.invoiceDraft.invoice.pdfUrl,
            pdfAvailable: Boolean(order.invoiceDraft.invoice.pdfPath),
            trendyolSentAt: order.invoiceDraft.invoice.trendyolSentAt?.toISOString(),
            trendyolStatus: order.invoiceDraft.invoice.trendyolStatus,
            error: order.invoiceDraft.invoice.error,
            createdAt: order.invoiceDraft.invoice.createdAt.toISOString(),
            updatedAt: order.invoiceDraft.invoice.updatedAt.toISOString()
          }
        : null,
      externalInvoices: order.externalInvoices.map((invoice: any) => ({
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
        matchedOrderNumber: order.orderNumber,
        matchedShipmentPackageId: order.shipmentPackageId,
        matchScore: invoice.matchScore,
        matchReason: invoice.matchReason ?? undefined,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString()
      }))
    };
  }

  async syncDeliveredOrders() {
    const packages = await this.trendyol.fetchDeliveredPackages();
    let upserted = 0;
    let draftsCreated = 0;
    let draftsUpdated = 0;

    for (const pkg of packages) {
      const normalized = normalizeTrendyolPackage(pkg);
      if (!normalized.shipmentPackageId) continue;

      const order = await this.prisma.order.upsert({
        where: { shipmentPackageId: normalized.shipmentPackageId },
        update: {
          orderNumber: normalized.orderNumber,
          status: normalized.status,
          customerName: normalized.customerName,
          customerEmail: normalized.customerEmail,
          customerIdentifier: normalized.customerIdentifier,
          invoiceAddress: json(normalized.invoiceAddress),
          raw: json(normalized.raw),
          totalGrossCents: normalized.totalGrossCents,
          totalDiscountCents: normalized.totalDiscountCents,
          totalPayableCents: normalized.totalPayableCents,
          currency: normalized.currency,
          lastModifiedAt: normalized.lastModifiedAt
        },
        create: {
          shipmentPackageId: normalized.shipmentPackageId,
          orderNumber: normalized.orderNumber,
          status: normalized.status,
          customerName: normalized.customerName,
          customerEmail: normalized.customerEmail,
          customerIdentifier: normalized.customerIdentifier,
          invoiceAddress: json(normalized.invoiceAddress),
          raw: json(normalized.raw),
          totalGrossCents: normalized.totalGrossCents,
          totalDiscountCents: normalized.totalDiscountCents,
          totalPayableCents: normalized.totalPayableCents,
          currency: normalized.currency,
          lastModifiedAt: normalized.lastModifiedAt
        }
      });

      upserted += 1;

      const draft = buildDraft(normalized);
      const draftStatus = toDraftStatus(draft.status);
      const existingDraft = await this.prisma.invoiceDraft.findUnique({ where: { orderId: order.id }, include: { invoice: true } });
      if (!existingDraft) {
        await this.prisma.invoiceDraft.create({
          data: {
            orderId: order.id,
            status: draftStatus,
            validation: json(draft.validation),
            lines: json(draft.lines),
            totals: json(draft.totals)
          }
        });
        draftsCreated += 1;
        continue;
      }

      if (!refreshableDraftStatuses.has(existingDraft.status) || existingDraft.invoice || existingDraft.portalDraftUuid) {
        continue;
      }

      const contentChanged =
        !sameJson(existingDraft.validation, draft.validation) ||
        !sameJson(existingDraft.lines, draft.lines) ||
        !sameJson(existingDraft.totals, draft.totals);
      const nextStatus = existingDraft.status === DraftStatus.APPROVED && !contentChanged ? DraftStatus.APPROVED : draftStatus;

      if (contentChanged || existingDraft.status !== nextStatus) {
        await this.prisma.invoiceDraft.update({
          where: { id: existingDraft.id },
          data: {
            status: nextStatus,
            validation: json(draft.validation),
            lines: json(draft.lines),
            totals: json(draft.totals),
            ...(contentChanged ? { approvedAt: null } : {})
          }
        });
        draftsUpdated += 1;
      }
    }

    const trendyolInvoices = await this.externalInvoices.syncTrendyolMetadata();

    await this.prisma.auditLog.create({
      data: {
        action: "trendyol.sync",
        subjectType: "orders",
        subjectId: "trendyol",
        message: `${upserted} Trendyol paketi senkronize edildi, ${draftsCreated} taslak olusturuldu, ${draftsUpdated} acik taslak guncellendi, ${trendyolInvoices.imported} Trendyol fatura kaydi yakalandi.`,
        metadata: { packageCount: packages.length, upserted, draftsCreated, draftsUpdated, trendyolInvoices }
      }
    });

    return {
      packageCount: packages.length,
      upserted,
      draftsCreated,
      draftsUpdated,
      externalInvoicesImported: trendyolInvoices.imported,
      externalInvoicesMatched: trendyolInvoices.matched
    };
  }
}
