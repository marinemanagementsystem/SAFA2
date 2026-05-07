import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { JobStatus, Prisma } from "@prisma/client";
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
    const created = [];

    for (const draftId of draftIds) {
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

    return { enqueued: created.length, jobs: created };
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
