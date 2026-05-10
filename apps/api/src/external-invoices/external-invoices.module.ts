import { Module } from "@nestjs/common";
import { EarsivPortalModule } from "../earsiv-portal/earsiv-portal.module";
import { ExternalInvoicesController } from "./external-invoices.controller";
import { ExternalInvoicesService } from "./external-invoices.service";

@Module({
  imports: [EarsivPortalModule],
  controllers: [ExternalInvoicesController],
  providers: [ExternalInvoicesService],
  exports: [ExternalInvoicesService]
})
export class ExternalInvoicesModule {}
