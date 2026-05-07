import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DraftStatus, InvoiceStatus, JobStatus, Prisma } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { envBool } from "../common/env";
import { PrismaService } from "../prisma/prisma.service";
import { TrendyolService } from "../trendyol/trendyol.service";
import { ArchiveInvoicePayload, InvoiceProvider } from "./invoice-provider";
import { buildInvoicePdf } from "./pdf/simple-invoice-pdf";
import { INVOICE_PROVIDER } from "./providers/invoice-provider.token";

interface ValidationJson {
  errors?: string[];
  warnings?: string[];
}

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrendyolService) private readonly trendyol: TrendyolService,
    @Inject(INVOICE_PROVIDER) private readonly provider: InvoiceProvider
  ) {}

  async listDrafts() {
    const drafts = await this.prisma.invoiceDraft.findMany({
      orderBy: [{ updatedAt: "desc" }],
      include: { order: true },
      take: 500
    });

    return drafts.map((draft) => {
      const validation = draft.validation as ValidationJson;
      const lines = Array.isArray(draft.lines) ? draft.lines : [];
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
        approvedAt: draft.approvedAt?.toISOString()
      };
    });
  }

  async listInvoices() {
    const invoices = await this.prisma.invoice.findMany({
      orderBy: [{ invoiceDate: "desc" }],
      include: { draft: { include: { order: true } } },
      take: 500
    });

    return invoices.map((invoice) => ({
      id: invoice.id,
      draftId: invoice.draftId,
      orderNumber: invoice.draft.order.orderNumber,
      shipmentPackageId: invoice.draft.order.shipmentPackageId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString(),
      status: invoice.status,
      pdfUrl: invoice.pdfUrl,
      trendyolStatus: invoice.trendyolStatus
    }));
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
        include: { order: true, invoice: true }
      });

      if (!draft) throw new NotFoundException("Fatura taslagi bulunamadi.");
      if (draft.invoice) return draft.invoice;
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
      title: "e-Arsiv Fatura Taslagi",
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
          trendyolStatus: response.mode === "mock" ? "MOCK_SENT" : "SENT",
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
