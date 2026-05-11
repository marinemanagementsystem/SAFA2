import { Module } from "@nestjs/common";
import { ExternalInvoicesModule } from "../external-invoices/external-invoices.module";
import { TrendyolModule } from "../trendyol/trendyol.module";
import { OrdersController } from "./orders.controller";
import { OrdersScheduler } from "./orders.scheduler";
import { OrdersService } from "./orders.service";

@Module({
  imports: [TrendyolModule, ExternalInvoicesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersScheduler],
  exports: [OrdersService]
})
export class OrdersModule {}
