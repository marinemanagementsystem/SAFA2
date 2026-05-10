import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ExternalInvoiceSource } from "@prisma/client";
import { z } from "zod";
import { ExternalInvoicesService } from "./external-invoices.service";

const sourceSchema = z.enum(["GIB_PORTAL", "TRENDYOL", "MANUAL"]);

const importSchema = z.object({
  source: sourceSchema,
  invoices: z.array(z.record(z.string(), z.unknown())).min(1)
});

const reconcileSchema = z.object({
  source: sourceSchema.optional()
});

const syncGibSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

const manualMatchSchema = z
  .object({
    orderId: z.string().optional(),
    orderNumber: z.string().optional(),
    shipmentPackageId: z.string().optional()
  })
  .refine((value) => Boolean(value.orderId || value.orderNumber || value.shipmentPackageId), {
    message: "Siparis ID, siparis no veya paket no zorunlu."
  });

@Controller()
export class ExternalInvoicesController {
  constructor(@Inject(ExternalInvoicesService) private readonly externalInvoices: ExternalInvoicesService) {}

  @Get("external-invoices")
  list(@Query("source") source?: string) {
    const parsedSource = source ? sourceSchema.parse(source) : undefined;
    return this.externalInvoices.list(parsedSource as ExternalInvoiceSource | undefined);
  }

  @Post("external-invoices/import")
  import(@Body() body: unknown) {
    const parsed = importSchema.parse(body);
    return this.externalInvoices.importRecords(parsed.source as ExternalInvoiceSource, parsed.invoices);
  }

  @Post("external-invoices/reconcile")
  reconcile(@Body() body: unknown) {
    const parsed = reconcileSchema.parse(body ?? {});
    return this.externalInvoices.reconcile(parsed.source as ExternalInvoiceSource | undefined);
  }

  @Post("external-invoices/sync/gib-portal")
  syncGibPortal(@Body() body: unknown) {
    const parsed = syncGibSchema.parse(body ?? {});
    return this.externalInvoices.syncGibPortal(parsed);
  }

  @Post("external-invoices/sync/trendyol")
  syncTrendyol() {
    return this.externalInvoices.syncTrendyolMetadata();
  }

  @Post("external-invoices/:id/match")
  manualMatch(@Param("id") id: string, @Body() body: unknown) {
    const parsed = manualMatchSchema.parse(body);
    return this.externalInvoices.manualMatch(id, parsed);
  }

  @Delete("external-invoices/:id/match")
  clearMatch(@Param("id") id: string) {
    return this.externalInvoices.clearMatch(id);
  }
}
