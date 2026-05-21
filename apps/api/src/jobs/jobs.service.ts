import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { DraftStatus, JobStatus, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { ExternalInvoicesService } from "../external-invoices/external-invoices.service";
import { InvoiceService } from "../invoice/invoice.service";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { TrendyolService } from "../trendyol/trendyol.service";

type JsonRecord = Record<string, any>;

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stripLargeJobResponse(value: JsonRecord = {}) {
  const { invoices: _invoices, records: _records, ...rest } = value;
  return rest;
}

function stripLargeJobPayload(value: JsonRecord = {}) {
  const { records: _records, ...rest } = value;
  return rest;
}

function mapJob(job: any) {
  return {
    id: job.id,
    type: job.type,
    target: job.target,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError ?? undefined,
    payload: stripLargeJobPayload(jsonRecord(job.payload)),
    response: stripLargeJobResponse(jsonRecord(job.response)),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly connection?: IORedis;
  private readonly queue?: Queue;
  private readonly syncMode = process.env.QUEUE_MODE === "sync";

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InvoiceService) private readonly invoiceService: InvoiceService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(ExternalInvoicesService) private readonly externalInvoices: ExternalInvoicesService,
    @Inject(TrendyolService) private readonly trendyol: TrendyolService
  ) {
    if (this.syncMode) {
      return;
    }

    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("invoice-issue", { connection: this.connection });
  }

  async enqueueInvoiceIssue(draftIds: string[]) {
    const uniqueDraftIds = Array.from(new Set(draftIds));
    const drafts = await this.prisma.invoiceDraft.findMany({
      where: { id: { in: uniqueDraftIds } },
      include: {
        invoice: true,
        order: {
          include: {
            externalInvoices: {
              take: 1
            }
          }
        }
      }
    });
    const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
    const created = [];
    const failures: Array<{ draftId: string; error: string }> = [];
    let autoApproved = 0;
    let processed = 0;

    for (const draftId of uniqueDraftIds) {
      const draft = draftsById.get(draftId);
      if (!draft) {
        failures.push({ draftId, error: "Fatura taslagi bulunamadi." });
        continue;
      }

      const validation = draft.validation as { errors?: unknown[] };
      if ((validation.errors ?? []).length > 0) {
        failures.push({ draftId, error: "Bu taslakta hata var. Once taslak uyarilarini duzeltin." });
        continue;
      }

      if (draft.invoice) {
        failures.push({ draftId, error: "Bu taslak icin fatura zaten kesilmis." });
        continue;
      }

      if (draft.order.externalInvoices.length > 0) {
        failures.push({ draftId, error: "Bu siparis icin harici e-Arsiv faturasi bulundu; tekrar fatura kesimi engellendi." });
        continue;
      }

      if (draft.status === DraftStatus.PORTAL_DRAFTED) {
        failures.push({ draftId, error: "Bu taslak GIB portalina yuklenmis. Imza portaldan tamamlanmali; resmi faturayi sonra e-Arsiv sorgula ile okuyun." });
        continue;
      }

      if (draft.status === DraftStatus.READY || draft.status === DraftStatus.ERROR) {
        const approval = await this.prisma.invoiceDraft.updateMany({
          where: { id: draft.id, status: draft.status },
          data: { status: DraftStatus.APPROVED, approvedAt: draft.approvedAt ?? new Date() }
        });
        autoApproved += approval.count;
      } else if (draft.status !== DraftStatus.APPROVED) {
        failures.push({ draftId, error: "Fatura kesmek icin taslak hazir, onayli veya tekrar denenebilir durumda olmali." });
        continue;
      }

      const jobRecord = await this.prisma.integrationJob.create({
        data: {
          type: "invoice.issue",
          target: draftId,
          status: JobStatus.PENDING,
          payload: { draftId } as Prisma.InputJsonValue
        }
      });

      created.push(jobRecord);

      if (this.syncMode) {
        try {
          await this.invoiceService.issueDraft(draftId, jobRecord.id);
          processed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Fatura kesimi tamamlanamadi.";
          failures.push({ draftId, error: message });
        }
      } else {
        await this.queue?.add(
          "issue-draft",
          { draftId, integrationJobId: jobRecord.id },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 500
          }
        );
      }
    }

    if (created.length === 0 && failures.length > 0) {
      throw new BadRequestException(failures.map((failure) => failure.error).join(" "));
    }

    return {
      requested: uniqueDraftIds.length,
      enqueued: this.syncMode ? 0 : created.length,
      processed: this.syncMode ? processed : 0,
      autoApproved,
      failed: failures.length,
      failures,
      jobs: created
    };
  }

  async listJobs() {
    const jobs = await this.prisma.integrationJob.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200
    });

    return jobs.map(mapJob);
  }

  async getJob(id: string) {
    const job = await this.prisma.integrationJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Islem bulunamadi.");
    return mapJob(job);
  }

  async startTrendyolSyncJob() {
    const end = new Date();
    const lookbackDays = Number(process.env.TRENDYOL_LOOKBACK_DAYS ?? 14);
    const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const job = await this.prisma.integrationJob.create({
      data: {
        type: "trendyol.sync",
        target: "trendyol",
        status: JobStatus.PENDING,
        payload: {
          kind: "trendyol-sync",
          phase: "orders",
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          nextCursor: undefined,
          page: 0
        } as Prisma.InputJsonValue,
        response: {
          message: "Trendyol siparis yenileme ve fatura izi yakalama baslatildi."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(job);
  }

  async startGibPortalApplyJob(input: JsonRecord) {
    const job = await this.prisma.integrationJob.create({
      data: {
        type: "gib-portal.apply",
        target: "gib-portal",
        status: JobStatus.PENDING,
        payload: {
          kind: "gib-portal-apply",
          phase: "query",
          input
        } as Prisma.InputJsonValue,
        response: {
          message: "e-Arsiv portal guvenli uygulama baslatildi."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(job);
  }

  async runNextJob(id: string) {
    const job = await this.prisma.integrationJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Islem bulunamadi.");
    if (job.status === JobStatus.SUCCESS || job.status === JobStatus.FAILED) return mapJob(job);

    try {
      if (job.type === "trendyol.sync") return this.runNextTrendyolJob(job);
      if (job.type === "gib-portal.apply") return this.runNextGibPortalApplyJob(job);
      throw new BadRequestException("Bu islem tipi parca parca calistirilamaz.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Islem tamamlanamadi.";
      const failed = await this.prisma.integrationJob.update({
        where: { id },
        data: {
          status: JobStatus.FAILED,
          lastError: message,
          response: {
            ...stripLargeJobResponse(jsonRecord(job.response)),
            message
          } as Prisma.InputJsonValue
        }
      });
      return mapJob(failed);
    }
  }

  private async runNextTrendyolJob(job: any) {
    const payload = jsonRecord(job.payload);
    const response = stripLargeJobResponse(jsonRecord(job.response));
    const phase = payload.phase ?? "orders";

    if (phase === "orders") {
      const page = await this.trendyol.fetchDeliveredPackagePage({
        startDate: payload.startDate,
        endDate: payload.endDate,
        nextCursor: payload.nextCursor
      });
      const orderResult = await this.ordersService.syncDeliveredOrderPackages(page.content ?? []);
      const nextResponse = {
        ...response,
        packageCount: Number(response.packageCount ?? 0) + orderResult.packageCount,
        ordersUpserted: Number(response.ordersUpserted ?? 0) + orderResult.upserted,
        draftsCreated: Number(response.draftsCreated ?? 0) + orderResult.draftsCreated,
        draftsUpdated: Number(response.draftsUpdated ?? 0) + orderResult.draftsUpdated,
        message: page.nextCursor
          ? "Trendyol siparisleri yenileniyor; fatura izi islemeye hazirlaniyor."
          : "Trendyol siparisleri yenilendi; fatura izi isleniyor."
      };
      const nextPayload = {
        ...payload,
        nextCursor: page.nextCursor,
        page: Number(payload.page ?? 0) + 1,
        phase: page.nextCursor ? "orders" : "invoice-metadata"
      };

      if (page.nextCursor) {
        const updated = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.PROCESSING,
            attempts: job.attempts + 1,
            payload: nextPayload as Prisma.InputJsonValue,
            response: nextResponse as Prisma.InputJsonValue
          }
        });
        return mapJob(updated);
      }

      const invoiceResult = await this.externalInvoices.syncTrendyolMetadata({ includeInvoices: false });
      const completed = await this.prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.SUCCESS,
          attempts: job.attempts + 1,
          payload: { ...nextPayload, phase: "done" } as Prisma.InputJsonValue,
          response: {
            ...nextResponse,
            externalInvoicesImported: invoiceResult.imported,
            externalInvoicesMatched: invoiceResult.matched,
            externalInvoicesUnmatched: invoiceResult.unmatched,
            message:
              invoiceResult.imported > 0
                ? `${invoiceResult.imported} Trendyol fatura izi yakalandi; ${invoiceResult.matched} tanesi siparisle eslesti.`
                : "Trendyol siparis verisinde fatura izi henuz yok."
          } as Prisma.InputJsonValue
        }
      });
      return mapJob(completed);
    }

    const invoiceResult = await this.externalInvoices.syncTrendyolMetadata({ includeInvoices: false });
    const completed = await this.prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        attempts: job.attempts + 1,
        payload: { ...payload, phase: "done" } as Prisma.InputJsonValue,
        response: {
          ...response,
          externalInvoicesImported: invoiceResult.imported,
          externalInvoicesMatched: invoiceResult.matched,
          externalInvoicesUnmatched: invoiceResult.unmatched,
          message:
            invoiceResult.imported > 0
              ? `${invoiceResult.imported} Trendyol fatura izi yakalandi; ${invoiceResult.matched} tanesi siparisle eslesti.`
              : "Trendyol siparis verisinde fatura izi henuz yok."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(completed);
  }

  private async runNextGibPortalApplyJob(job: any) {
    const step = await this.externalInvoices.runGibPortalApplyJobStep(jsonRecord(job.payload), stripLargeJobResponse(jsonRecord(job.response)));
    const updated = await this.prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: step.done ? JobStatus.SUCCESS : JobStatus.PROCESSING,
        attempts: job.attempts + 1,
        payload: step.payload as Prisma.InputJsonValue,
        response: {
          ...stripLargeJobResponse(step.response),
          message: step.message
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(updated);
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
