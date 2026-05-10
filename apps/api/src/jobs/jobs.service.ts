import { BadRequestException, Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { DraftStatus, JobStatus, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
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

      await this.queue.add(
        "issue-draft",
        { draftId, integrationJobId: jobRecord.id },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500
        }
      );

      created.push(jobRecord);
    }

    if (created.length === 0 && failures.length > 0) {
      throw new BadRequestException(failures.map((failure) => failure.error).join(" "));
    }

    return { requested: uniqueDraftIds.length, enqueued: created.length, autoApproved, failed: failures.length, failures, jobs: created };
  }

  async listJobs() {
    const jobs = await this.prisma.integrationJob.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200
    });

    return jobs.map((job) => ({
      id: job.id,
      type: job.type,
      target: job.target,
      status: job.status,
      attempts: job.attempts,
      lastError: job.lastError ?? undefined,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    }));
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.connection.disconnect();
  }
}
