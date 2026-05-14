import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { InvoiceService } from "../invoice/invoice.service";

@Injectable()
export class InvoiceIssueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceIssueWorker.name);
  private connection?: IORedis;
  private worker?: Worker;

  constructor(@Inject(InvoiceService) private readonly invoiceService: InvoiceService) {}

  onModuleInit() {
    if (process.env.QUEUE_MODE === "sync") {
      this.logger.log("Invoice queue worker disabled because QUEUE_MODE=sync.");
      return;
    }

    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      "invoice-issue",
      async (job) => {
        await this.invoiceService.issueDraft(job.data.draftId, job.data.integrationJobId);
      },
      { connection: this.connection, concurrency: 3 }
    );

    this.worker.on("failed", (job, error) => {
      this.logger.error(`Invoice job ${job?.id ?? "unknown"} failed: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
