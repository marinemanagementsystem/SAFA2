import { Body, Controller, Get, Header, Inject, Param, Post, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { z } from "zod";
import { InvoiceService } from "./invoice.service";
import { MonthlyInvoiceArchiveService } from "./monthly-invoice-archive.service";

const portalDraftUploadSchema = z.object({
  draftIds: z.array(z.string().min(1)).min(1).max(500)
});

const monthlyInvoiceSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

@Controller()
export class InvoiceController {
  constructor(
    @Inject(InvoiceService) private readonly invoiceService: InvoiceService,
    @Inject(MonthlyInvoiceArchiveService) private readonly monthlyArchiveService: MonthlyInvoiceArchiveService
  ) {}

  @Get("invoice-drafts")
  listDrafts() {
    return this.invoiceService.listDrafts();
  }

  @Post("invoice-drafts/:id/approve")
  approveDraft(@Param("id") id: string) {
    return this.invoiceService.approveDraft(id);
  }

  @Post("invoice-drafts/gib-portal-drafts")
  uploadPortalDrafts(@Body() body: unknown) {
    const parsed = portalDraftUploadSchema.parse(body);
    return this.invoiceService.uploadDraftsToGibPortal(parsed.draftIds);
  }

  @Get("invoice-drafts/:id/earsiv-xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  async getDraftXml(@Param("id") id: string, @Res() response: Response) {
    const xml = await this.invoiceService.getDraftEarsivXml(id);
    response.send(xml);
  }

  @Get("invoice-drafts/:id/pdf")
  @Header("Content-Type", "application/pdf")
  async getDraftPdf(@Param("id") id: string, @Res() response: Response) {
    const pdf = await this.invoiceService.getDraftPdf(id);
    response.send(pdf);
  }

  @Get("invoices")
  listInvoices() {
    return this.invoiceService.listInvoices();
  }

  @Get("invoices/monthly-export.xlsx")
  async exportMonthlyExcel(@Query() query: unknown, @Res() response: Response) {
    const parsed = monthlyInvoiceSchema.parse(query);
    const buffer = await this.monthlyArchiveService.buildMonthlyExcel(parsed);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="${this.monthlyArchiveService.excelFileName(parsed)}"`);
    response.send(buffer);
  }

  @Post("invoices/monthly-archives")
  createMonthlyArchive(@Body() body: unknown) {
    const parsed = monthlyInvoiceSchema.parse(body);
    return this.monthlyArchiveService.createMonthlyArchive(parsed);
  }

  @Get("invoices/monthly-archives/:year/:month/download")
  async downloadMonthlyArchive(@Param() params: unknown, @Res() response: Response) {
    const parsed = monthlyInvoiceSchema.parse(params);
    const buffer = await this.monthlyArchiveService.readMonthlyArchive(parsed);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${this.monthlyArchiveService.archiveFileName(parsed)}"`);
    response.send(buffer);
  }

  @Get("invoices/:id/pdf")
  @Header("Content-Type", "application/pdf")
  async getPdf(@Param("id") id: string, @Res() response: Response) {
    const pdf = await this.invoiceService.getInvoicePdf(id);
    response.send(pdf);
  }

  @Post("invoices/:id/send-to-trendyol")
  sendToTrendyol(@Param("id") id: string) {
    return this.invoiceService.sendToTrendyol(id);
  }
}
