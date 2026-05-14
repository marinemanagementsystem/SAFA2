import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DraftStatus, InvoiceStatus, JobStatus, Prisma } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { EarsivPortalService } from "../earsiv-portal/earsiv-portal.service";
import { buildGibPortalInvoiceDraftPayload } from "../earsiv-portal/portal-draft-payload";
import { PrismaService } from "../prisma/prisma.service";
import { TrendyolService } from "../trendyol/trendyol.service";
import { extractTrendyolDeliveryDate } from "../trendyol/trendyol-normalizer";
import { ArchiveInvoicePayload, InvoiceProvider } from "./invoice-provider";
import { buildInvoicePdf } from "./pdf/simple-invoice-pdf";
import { INVOICE_PROVIDER } from "./providers/invoice-provider.token";

interface ValidationJson {
  errors?: string[];
  warnings?: string[];
}

interface PortalDraftCandidate {
  draft: Prisma.InvoiceDraftGetPayload<{
    include: {
      order: {
        include: {
          externalInvoices: true;
        };
      };
      invoice: true;
    };
  }>;
  previousStatus: DraftStatus;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function trendyolInvoiceSignal(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  return (
    stringValue(record.invoiceLink) ||
    stringValue(record.invoiceUrl) ||
    stringValue(record.invoiceNumber) ||
    stringValue(record.faturaNo) ||
    stringValue(record.ettn) ||
    stringValue(record.uuid) ||
    undefined
  );
}

function externalInvoiceBlockMessage(signal?: string) {
  const linkText = signal ? ` Trendyol fatura kaydi: ${signal}` : "";
  return `Bu siparis Trendyol'da faturali gorunuyor; tekrar GIB portal taslagi veya SAFA faturasi olusturmayin.${linkText}`;
}

function deliveredAtForOrder(raw: unknown, status: string, fallback?: Date | null) {
  return extractTrendyolDeliveryDate(raw) ?? (status.toLocaleLowerCase("tr-TR") === "delivered" ? fallback ?? undefined : undefined);
}

function deliveredSortTime(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrendyolService) private readonly trendyol: TrendyolService,
    @Inject(EarsivPortalService) private readonly earsivPortal: EarsivPortalService,
    @Inject(INVOICE_PROVIDER) private readonly provider: InvoiceProvider
  ) {}

  async listDrafts() {
    const drafts = await this.prisma.invoiceDraft.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: {
        order: {
          include: {
            externalInvoices: {
              orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
              take: 3
            },
            _count: { select: { externalInvoices: true } }
          }
        }
      },
      take: 500
    });

    return drafts
      .map((draft) => {
        const validation = draft.validation as ValidationJson;
        const lines = Array.isArray(draft.lines) ? draft.lines : [];
        const deliveredAt = deliveredAtForOrder(draft.order.raw, draft.order.status, draft.order.lastModifiedAt);

        return {
          id: draft.id,
          orderId: draft.orderId,
          shipmentPackageId: draft.order.shipmentPackageId,
          orderNumber: draft.order.orderNumber,
          customerName: draft.order.customerName,
          status: draft.status,
          warnings: validation.warnings ?? [],
          errors: validation.errors ?? [],
          lineCount: lines.length,
          totalPayableCents: draft.order.totalPayableCents,
          currency: draft.order.currency,
          deliveredAt: deliveredAt?.toISOString(),
          approvedAt: draft.approvedAt?.toISOString(),
          portalDraftUuid: draft.portalDraftUuid ?? undefined,
          portalDraftNumber: draft.portalDraftNumber ?? undefined,
          portalDraftUploadedAt: draft.portalDraftUploadedAt?.toISOString(),
          portalDraftStatus: draft.portalDraftStatus ?? undefined,
          externalInvoiceCount: draft.order._count.externalInvoices,
          externalInvoiceSources: Array.from(new Set(draft.order.externalInvoices.map((invoice: any) => invoice.source))),
          externalInvoiceNumber: draft.order.externalInvoices[0]?.invoiceNumber ?? undefined,
          externalInvoiceDate: draft.order.externalInvoices[0]?.invoiceDate?.toISOString()
        };
      })
      .sort(
        (left, right) =>
          deliveredSortTime(right.deliveredAt ?? right.approvedAt) - deliveredSortTime(left.deliveredAt ?? left.approvedAt)
      );
  }

  async listInvoices() {
    const invoices = await this.prisma.invoice.findMany({
      orderBy: [{ invoiceDate: "desc" }],
      include: { draft: { include: { order: true } } },
      take: 500
    });

    return invoices
      .map((invoice) => {
        const deliveredAt = deliveredAtForOrder(invoice.draft.order.raw, invoice.draft.order.status, invoice.draft.order.lastModifiedAt);

        return {
          id: invoice.id,
          draftId: invoice.draftId,
          orderNumber: invoice.draft.order.orderNumber,
          shipmentPackageId: invoice.draft.order.shipmentPackageId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString(),
          deliveredAt: deliveredAt?.toISOString(),
          status: invoice.status,
          pdfUrl: invoice.pdfUrl,
          trendyolStatus: invoice.trendyolStatus
        };
      })
      .sort(
        (left, right) =>
          deliveredSortTime(right.deliveredAt ?? right.invoiceDate) - deliveredSortTime(left.deliveredAt ?? left.invoiceDate)
      );
  }

  async approveDraft(id: string) {
    const draft = await this.prisma.invoiceDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException("Fatura taslagi bulunamadi.");

    const validation = draft.validation as ValidationJson;
    if ((validation.errors ?? []).length > 0) {
      throw new BadRequestException("Hata iceren taslak onaylanamaz.");
    }

    return this.prisma.invoiceDraft.update({
      where: { id },
      data: { status: DraftStatus.APPROVED, approvedAt: new Date() }
    });
  }

  async uploadDraftsToGibPortal(draftIds: string[]) {
    const uniqueDraftIds = Array.from(new Set(draftIds));
    const drafts = await this.prisma.invoiceDraft.findMany({
      where: { id: { in: uniqueDraftIds } },
      include: {
        order: {
          include: {
            externalInvoices: {
              orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }]
            }
          }
        },
        invoice: true
      }
    });
    const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
    const failures: Array<{ draftId: string; error: string }> = [];
    const candidates: PortalDraftCandidate[] = [];

    for (const draftId of uniqueDraftIds) {
      const draft = draftsById.get(draftId);
      if (!draft) {
        failures.push({ draftId, error: "Fatura taslagi bulunamadi." });
        continue;
      }

      const validation = draft.validation as ValidationJson;
      if ((validation.errors ?? []).length > 0) {
        failures.push({ draftId, error: "Hata iceren taslak GIB portalina yuklenemez." });
        continue;
      }

      if (draft.invoice) {
        failures.push({ draftId, error: "Bu taslak SAFA tarafinda zaten kesilmis." });
        continue;
      }

      if (draft.order.externalInvoices.length > 0) {
        failures.push({ draftId, error: "Bu siparis icin harici e-Arsiv faturasi bulundu; tekrar taslak yukleme engellendi." });
        continue;
      }

      const invoiceSignal = trendyolInvoiceSignal(draft.order.raw);
      if (invoiceSignal) {
        failures.push({ draftId, error: externalInvoiceBlockMessage(invoiceSignal) });
        continue;
      }

      if (draft.portalDraftUuid || draft.status === DraftStatus.PORTAL_DRAFTED) {
        failures.push({ draftId, error: "Bu taslak daha once GIB portalina yuklenmis." });
        continue;
      }

      if (draft.status !== DraftStatus.READY && draft.status !== DraftStatus.APPROVED) {
        failures.push({ draftId, error: "GIB portalina yuklemek icin taslak hazir veya onayli olmali." });
        continue;
      }

      candidates.push({ draft, previousStatus: draft.status });
    }

    const claimedCandidates: PortalDraftCandidate[] = [];
    for (const candidate of candidates) {
      const claim = await this.prisma.invoiceDraft.updateMany({
        where: {
          id: candidate.draft.id,
          status: candidate.previousStatus,
          portalDraftUuid: null
        },
        data: { status: DraftStatus.ISSUING }
      });

      if (claim.count === 1) {
        claimedCandidates.push(candidate);
        continue;
      }

      failures.push({
        draftId: candidate.draft.id,
        error: "Bu taslak baska bir istek tarafindan isleniyor veya zaten GIB portalina yuklenmis."
      });
    }

    let portalResults: Awaited<ReturnType<EarsivPortalService["createInvoiceDrafts"]>> = [];
    try {
      portalResults =
        claimedCandidates.length > 0
          ? await this.earsivPortal.createInvoiceDrafts(
              claimedCandidates.map((candidate) => ({
                localDraftId: candidate.draft.id,
                payload: buildGibPortalInvoiceDraftPayload(this.toProviderPayload(candidate.draft))
              }))
            )
          : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : "GIB portal taslagi yuklenemedi.";
      for (const candidate of claimedCandidates) {
        failures.push({ draftId: candidate.draft.id, error: message });
        await this.prisma.invoiceDraft.update({
          where: { id: candidate.draft.id },
          data: {
            status: candidate.previousStatus,
            portalDraftStatus: "YUKLEME_HATASI",
            portalDraftResponse: json({ error: message })
          }
        });
      }

      return {
        requested: uniqueDraftIds.length,
        uploaded: 0,
        failed: failures.length,
        uploadedDrafts: [],
        failures
      };
    }

    const candidateById = new Map(claimedCandidates.map((candidate) => [candidate.draft.id, candidate]));
    let uploaded = 0;
    const uploadedDrafts: Array<{
      draftId: string;
      orderNumber: string;
      shipmentPackageId: string;
      customerName: string;
      totalPayableCents: number;
      currency: string;
      portalDraftStatus?: string;
      portalDraftUploadedAt?: string;
    }> = [];

    for (const result of portalResults) {
      const candidate = candidateById.get(result.localDraftId);
      if (!candidate) continue;

      if (result.ok) {
        const updated = await this.prisma.invoiceDraft.update({
          where: { id: candidate.draft.id },
          data: {
            status: DraftStatus.PORTAL_DRAFTED,
            approvedAt: candidate.draft.approvedAt ?? new Date(),
            ...(result.uuid ? { portalDraftUuid: result.uuid } : {}),
            portalDraftNumber: result.documentNumber,
            portalDraftUploadedAt: new Date(),
            portalDraftStatus: result.status ?? "Onaylanmadı",
            portalDraftResponse: json({
              command: result.command,
              pageName: result.pageName,
              message: result.message,
              response: result.response
            })
          }
        });

        uploaded += 1;
        uploadedDrafts.push({
          draftId: updated.id,
          orderNumber: candidate.draft.order.orderNumber,
          shipmentPackageId: candidate.draft.order.shipmentPackageId,
          customerName: candidate.draft.order.customerName,
          totalPayableCents: candidate.draft.order.totalPayableCents,
          currency: candidate.draft.order.currency,
          portalDraftStatus: updated.portalDraftStatus ?? undefined,
          portalDraftUploadedAt: updated.portalDraftUploadedAt?.toISOString()
        });
        await this.prisma.auditLog.create({
          data: {
            action: "invoice-draft.gib-portal.upload",
            subjectType: "invoiceDraft",
            subjectId: updated.id,
            message: `${candidate.draft.order.orderNumber} siparisi GIB e-Arsiv portalina taslak olarak yuklendi; imza portaldan beklenecek.`,
            metadata: {
              draftId: updated.id,
              orderNumber: candidate.draft.order.orderNumber,
              shipmentPackageId: candidate.draft.order.shipmentPackageId,
              portalDraftUuid: result.uuid,
              portalDraftStatus: result.status
            }
          }
        });
      } else {
        failures.push({
          draftId: candidate.draft.id,
          error: result.error ?? result.message ?? "GIB portal taslagi yuklenemedi."
        });

        await this.prisma.invoiceDraft.update({
          where: { id: candidate.draft.id },
          data: {
            status: candidate.previousStatus,
            portalDraftStatus: "YUKLEME_HATASI",
            portalDraftResponse: json({
              command: result.command,
              pageName: result.pageName,
              ...(result.attemptedUuid
                ? { attemptedUuid: result.attemptedUuid, attemptedUuidLength: result.attemptedUuid.length }
                : {}),
              error: result.error,
              message: result.message,
              response: result.response
            })
          }
        });
      }
    }

    return {
      requested: uniqueDraftIds.length,
      uploaded,
      failed: failures.length,
      uploadedDrafts,
      failures
    };
  }

  async issueDraft(draftId: string, integrationJobId?: string) {
    if (integrationJobId) {
      await this.prisma.integrationJob.update({
        where: { id: integrationJobId },
        data: { status: JobStatus.PROCESSING, attempts: { increment: 1 } }
      });
    }

    try {
      const draft = await this.prisma.invoiceDraft.findUnique({
        where: { id: draftId },
        include: {
          order: {
            include: {
              externalInvoices: {
                orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
                take: 1
              }
            }
          },
          invoice: true
        }
      });

      if (!draft) throw new NotFoundException("Fatura taslagi bulunamadi.");
      if (draft.invoice) return draft.invoice;
      if (draft.order.externalInvoices.length > 0) {
        throw new BadRequestException("Bu siparis icin harici e-Arsiv faturasi bulundu; tekrar fatura kesimi engellendi.");
      }
      const invoiceSignal = trendyolInvoiceSignal(draft.order.raw);
      if (invoiceSignal) {
        throw new BadRequestException(externalInvoiceBlockMessage(invoiceSignal));
      }
      if (draft.status === DraftStatus.PORTAL_DRAFTED) {
        throw new BadRequestException("Bu taslak GIB portalina yuklenmis; SAFA tekrar resmi fatura kesmez. Portaldaki taslagi imzalayin veya harici fatura varsa eslestirin.");
      }
      if (draft.status !== DraftStatus.APPROVED) {
        throw new BadRequestException("Fatura kesmek icin taslak once onaylanmali.");
      }

      await this.prisma.invoiceDraft.update({
        where: { id: draftId },
        data: { status: DraftStatus.ISSUING }
      });

      const payload = this.toProviderPayload(draft);
      const result = await this.provider.issueArchiveInvoice(payload);
      const pdfPath = await this.writeInvoicePdf(result.invoiceNumber, result.pdf);

      const invoice = await this.prisma.invoice.create({
        data: {
          draftId,
          provider: result.provider,
          providerInvoiceId: result.providerInvoiceId,
          invoiceNumber: result.invoiceNumber,
          invoiceDate: result.invoiceDate,
          status: InvoiceStatus.ISSUED,
          pdfPath,
          pdfUrl: result.pdfUrl
        }
      });

      await this.prisma.invoiceDraft.update({
        where: { id: draftId },
        data: { status: DraftStatus.ISSUED }
      });

      await this.prisma.auditLog.create({
        data: {
          action: "invoice.issue",
          subjectType: "invoice",
          subjectId: invoice.id,
          message: `${invoice.invoiceNumber} numarali e-Arsiv faturasi olusturuldu.`,
          metadata: { draftId, orderNumber: draft.order.orderNumber }
        }
      });

      await this.sendToTrendyol(invoice.id);

      if (integrationJobId) {
        await this.prisma.integrationJob.update({
          where: { id: integrationJobId },
          data: { status: JobStatus.SUCCESS, response: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } }
        });
      }

      return invoice;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen fatura hatasi";
      await this.prisma.invoiceDraft.updateMany({
        where: { id: draftId },
        data: { status: DraftStatus.ERROR }
      });

      if (integrationJobId) {
        await this.prisma.integrationJob.update({
          where: { id: integrationJobId },
          data: { status: JobStatus.FAILED, lastError: message }
        });
      }

      throw error;
    }
  }

  async getInvoicePdf(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice?.pdfPath) throw new NotFoundException("Fatura PDF bulunamadi.");
    return fs.readFile(invoice.pdfPath);
  }

  async getDraftPdf(draftId: string) {
    const draft = await this.prisma.invoiceDraft.findUnique({
      where: { id: draftId },
      include: { order: true }
    });
    if (!draft) throw new NotFoundException("Fatura taslagi bulunamadi.");

    return buildInvoicePdf(this.toProviderPayload(draft), {
      title: "e-Arşiv Fatura",
      documentNumber: `TASLAK-${draft.order.orderNumber}`,
      documentDate: draft.updatedAt
    });
  }

  async getDraftEarsivXml(draftId: string) {
    const draft = await this.prisma.invoiceDraft.findUnique({
      where: { id: draftId },
      include: { order: true }
    });
    if (!draft) throw new NotFoundException("Fatura taslagi bulunamadi.");

    const { buildGibDraftInvoiceXml } = await import("./ubl/gib-draft-invoice-xml");
    return buildGibDraftInvoiceXml(this.toProviderPayload(draft));
  }

  async sendToTrendyol(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { draft: { include: { order: true } } }
    });
    if (!invoice) throw new NotFoundException("Fatura bulunamadi.");
    if (!invoice.pdfPath) throw new BadRequestException("Fatura PDF dosyasi yok.");

    try {
      const response = await this.trendyol.sendInvoiceFile({
        shipmentPackageId: invoice.draft.order.shipmentPackageId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        pdfPath: invoice.pdfPath
      });

      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.TRENDYOL_SENT,
          trendyolStatus: "SENT",
          trendyolSentAt: new Date(),
          error: null
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trendyol fatura gonderimi basarisiz";
      return this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.TRENDYOL_SEND_FAILED,
          trendyolStatus: "SEND_FAILED",
          error: message
        }
      });
    }
  }

  private toProviderPayload(draft: Prisma.InvoiceDraftGetPayload<{ include: { order: true } }>): ArchiveInvoicePayload {
    const address = draft.order.invoiceAddress as Record<string, string | undefined>;
    const totals = draft.totals as Record<string, unknown>;
    const lines = draft.lines as ArchiveInvoicePayload["lines"];

    return {
      orderNumber: draft.order.orderNumber,
      shipmentPackageId: draft.order.shipmentPackageId,
      buyerName: draft.order.customerName,
      buyerIdentifier: String(totals.buyerIdentifier ?? draft.order.customerIdentifier ?? "11111111111"),
      address: {
        addressLine: address.addressLine ?? "",
        district: address.district,
        city: address.city ?? "",
        countryCode: address.countryCode ?? "TR"
      },
      lines,
      totals: {
        grossCents: Number(totals.grossCents ?? draft.order.totalGrossCents),
        discountCents: Number(totals.discountCents ?? draft.order.totalDiscountCents),
        payableCents: Number(totals.payableCents ?? draft.order.totalPayableCents),
        currency: String(totals.currency ?? draft.order.currency)
      }
    };
  }

  private async writeInvoicePdf(invoiceNumber: string, pdf: Buffer) {
    const storageDir = process.env.STORAGE_DIR ?? "./storage";
    const absoluteDir = path.resolve(process.cwd(), storageDir, "invoices");
    await fs.mkdir(absoluteDir, { recursive: true });
    const filePath = path.join(absoluteDir, `${invoiceNumber}.pdf`);
    await fs.writeFile(filePath, pdf);
    return filePath;
  }
}
