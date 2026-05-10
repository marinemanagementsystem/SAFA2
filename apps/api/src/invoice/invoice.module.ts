import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { TrendyolModule } from "../trendyol/trendyol.module";
import { InvoiceController } from "./invoice.controller";
import { InvoiceService } from "./invoice.service";
import { GibDirectInvoiceProvider } from "./providers/gib-direct-invoice.provider";
import { invoiceProviderFactory } from "./providers/invoice-provider.token";

@Module({
  imports: [TrendyolModule, SettingsModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceService,
    GibDirectInvoiceProvider,
    invoiceProviderFactory
  ],
  exports: [InvoiceService]
})
export class InvoiceModule {}
