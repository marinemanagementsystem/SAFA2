import { Module } from "@nestjs/common";
import { TrendyolModule } from "../trendyol/trendyol.module";
import { InvoiceController } from "./invoice.controller";
import { InvoiceService } from "./invoice.service";
import { GibDirectInvoiceProvider } from "./providers/gib-direct-invoice.provider";
import { invoiceProviderFactory } from "./providers/invoice-provider.token";
import { MockInvoiceProvider } from "./providers/mock-invoice.provider";

@Module({
  imports: [TrendyolModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    MockInvoiceProvider,
    GibDirectInvoiceProvider,
    invoiceProviderFactory
  ],
  exports: [InvoiceService]
})
export class InvoiceModule {}
