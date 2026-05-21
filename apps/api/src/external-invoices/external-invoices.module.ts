import { Module } from "@nestjs/common";
import { EarsivPortalModule } from "../earsiv-portal/earsiv-portal.module";
import { TrendyolModule } from "../trendyol/trendyol.module";
import { ExternalInvoicesController } from "./external-invoices.controller";
import { ExternalInvoicesService } from "./external-invoices.service";
import { GibPortalFollowupScheduler } from "./gib-portal-followup.scheduler";

@Module({
  imports: [EarsivPortalModule, TrendyolModule],
  controllers: [ExternalInvoicesController],
  providers: [ExternalInvoicesService, GibPortalFollowupScheduler],
  exports: [ExternalInvoicesService]
})
export class ExternalInvoicesModule {}
