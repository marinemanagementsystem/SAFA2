import { Module } from "@nestjs/common";
import { ExternalInvoicesModule } from "../external-invoices/external-invoices.module";
import { InvoiceModule } from "../invoice/invoice.module";
import { OrdersModule } from "../orders/orders.module";
import { TrendyolModule } from "../trendyol/trendyol.module";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { InvoiceIssueWorker } from "./invoice-issue.worker";

@Module({
  imports: [InvoiceModule, OrdersModule, ExternalInvoicesModule, TrendyolModule],
  controllers: [JobsController],
  providers: [JobsService, InvoiceIssueWorker],
  exports: [JobsService]
})
export class JobsModule {}
