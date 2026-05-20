import { Body, Controller, Get, Inject, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { HepsiburadaService } from "./hepsiburada.service";

const productSchema = z.object({
  name: z.string().min(1),
  barcode: z.string().optional(),
  hbSku: z.string().optional(),
  merchantSku: z.string().min(1),
  brand: z.string().min(1),
  categoryName: z.string().min(1),
  vatRate: z.coerce.number().int().min(0).max(30).default(20),
  priceCents: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0).default(0),
  dispatchTime: z.coerce.number().int().min(1).max(30).default(2),
  description: z.string().optional(),
  active: z.coerce.boolean().default(true)
});

const productUpdateSchema = productSchema.partial();

const invoiceLinkSchema = z.object({
  packageNumber: z.string().optional()
});

@Controller()
export class HepsiburadaController {
  constructor(@Inject(HepsiburadaService) private readonly hepsiburada: HepsiburadaService) {}

  @Get("products")
  listProducts() {
    return this.hepsiburada.listProducts();
  }

  @Post("products")
  createProduct(@Body() body: unknown) {
    const parsed = productSchema.parse(body);
    return this.hepsiburada.createProduct(parsed);
  }

  @Put("products/:id")
  updateProduct(@Param("id") id: string, @Body() body: unknown) {
    const parsed = productUpdateSchema.parse(body);
    return this.hepsiburada.updateProduct(id, parsed);
  }

  @Post("integrations/hepsiburada/catalog/upload")
  uploadCatalog() {
    return this.hepsiburada.uploadCatalog();
  }

  @Get("integrations/hepsiburada/catalog/status/:trackingId")
  catalogStatus(@Param("trackingId") trackingId: string) {
    return this.hepsiburada.catalogStatus(trackingId);
  }

  @Post("integrations/hepsiburada/listings/sync")
  syncInventory() {
    return this.hepsiburada.syncInventory();
  }

  @Post("integrations/hepsiburada/listings/price-upload")
  uploadPrices() {
    return this.hepsiburada.uploadListingPrices();
  }

  @Post("integrations/hepsiburada/listings/stock-upload")
  uploadStocks() {
    return this.hepsiburada.uploadListingStocks();
  }

  @Post("integrations/hepsiburada/orders/sync")
  syncOrders() {
    return this.hepsiburada.syncOrders();
  }

  @Get("integrations/hepsiburada/order-lines")
  listOrderLines() {
    return this.hepsiburada.listOrderLines();
  }

  @Post("integrations/hepsiburada/test-orders/create")
  createTestOrder(@Body() body: unknown) {
    return this.hepsiburada.createTestOrder(body && typeof body === "object" ? (body as Record<string, unknown>) : {});
  }

  @Post("integrations/hepsiburada/order-lines/:id/package")
  packageOrderLine(@Param("id") id: string) {
    return this.hepsiburada.packageOrderLine(id);
  }

  @Post("invoices/:id/send-to-hepsiburada")
  sendInvoiceLink(@Param("id") id: string, @Body() body: unknown) {
    const parsed = invoiceLinkSchema.parse(body ?? {});
    return this.hepsiburada.sendInvoiceLink(id, parsed);
  }
}
