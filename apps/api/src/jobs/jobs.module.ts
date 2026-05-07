import { Module } from "@nestjs/common";
import { InvoiceModule } from "../invoice/invoice.module";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { InvoiceIssueWorker } from "./invoice-issue.worker";

@Module({
  imports: [InvoiceModule],
  controllers: [JobsController],
  providers: [JobsService, InvoiceIssueWorker],
  exports: [JobsService]
})
export class JobsModule {}
