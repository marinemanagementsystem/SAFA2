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

const GIB_FOLLOWUP_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SCHEDULED_GIB_FOLLOWUP_TARGET = "scheduled-gib-followup";
const MANUAL_GIB_FOLLOWUP_TARGET = "manual-gib-followup";
const MANUAL_CATCHUP_TARGET = "manual-catchup";
const AUTOMATION_BUDGET_GUARD_MODE = "free-tier-guard";
const DEFAULT_DAILY_AUTO_RUN_LIMIT = 4;
const GIB_FOLLOWUP_ACTIVE_RETENTION_HOURS = 48;
const GIB_FOLLOWUP_STALE_HOURS = 8;
const SCHEDULED_GIB_FOLLOWUP_HOURS = [9, 13, 17, 21];

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

function istanbulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function istanbulTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  };
}

function addIstanbulDays(dateKey: string, days: number) {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  return istanbulDateKey(new Date(start.getTime() + days * DAY_MS));
}

function nextScheduledGibFollowupAt(date = new Date()) {
  const todayKey = istanbulDateKey(date);
  const { hour, minute } = istanbulTimeParts(date);
  const currentMinute = hour * 60 + minute;
  const nextHour = SCHEDULED_GIB_FOLLOWUP_HOURS.find((item) => currentMinute < item * 60);
  const dateKey = nextHour === undefined ? addIstanbulDays(todayKey, 1) : todayKey;
  const hourValue = nextHour ?? SCHEDULED_GIB_FOLLOWUP_HOURS[0];
  return `${dateKey}T${String(hourValue).padStart(2, "0")}:00:00+03:00`;
}

function nonNegativeIntEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function dateMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
}

function isoDate(value: unknown) {
  const time = dateMs(value);
  return time > 0 ? new Date(time).toISOString() : undefined;
}

function scheduledGibFollowupInput(date = new Date()) {
  const endDateKey = istanbulDateKey(date);
  const endStart = new Date(`${endDateKey}T00:00:00+03:00`);
  const startDateKey = istanbulDateKey(new Date(endStart.getTime() - (GIB_FOLLOWUP_WINDOW_DAYS - 1) * DAY_MS));
  return {
    startDate: `${startDateKey}T00:00:00+03:00`,
    endDate: `${endDateKey}T23:59:59+03:00`
  };
}

function gibFollowupInput(payload: unknown) {
  const record = jsonRecord(payload);
  const input = jsonRecord(record.input);
  return {
    startDate: typeof input.startDate === "string" ? input.startDate : undefined,
    endDate: typeof input.endDate === "string" ? input.endDate : undefined
  };
}

function isCurrentGibFollowupJob(job: any, input: { startDate: string; endDate: string }) {
  const current = gibFollowupInput(job?.payload);
  return current.startDate === input.startDate && current.endDate === input.endDate;
}

function isRecentActiveJob(job: any, now = new Date()) {
  const updatedAt = dateMs(job?.updatedAt ?? job?.createdAt);
  return updatedAt > 0 && now.getTime() - updatedAt <= GIB_FOLLOWUP_ACTIVE_RETENTION_HOURS * HOUR_MS;
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

  async startAutomationRunNowJob() {
    const [activeJob] = await this.prisma.integrationJob.findMany({
      where: {
        type: "automation.catchup",
        target: MANUAL_CATCHUP_TARGET,
        status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 1
    });

    if (activeJob) return mapJob(activeJob);

    const job = await this.prisma.integrationJob.create({
      data: {
        type: "automation.catchup",
        target: MANUAL_CATCHUP_TARGET,
        status: JobStatus.PENDING,
        payload: {
          kind: "automation-catchup",
          phase: "trendyol-sync",
          scope: "all"
        } as Prisma.InputJsonValue,
        response: {
          message: "Manuel otomasyon guncellemesi baslatildi; once Trendyol, sonra GIB takip calisacak."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(job);
  }

  async automationStatus() {
    const now = new Date();
    const jobs = await this.prisma.integrationJob.findMany({
      where: {
        OR: [
          { type: "gib-portal.followup" },
          { type: "trendyol.sync" },
          { type: "automation.catchup" }
        ]
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 500
    });
    const latestGib = this.latestSuccessfulJob(jobs, (job) => job.type === "gib-portal.followup");
    const latestTrendyol = this.latestSuccessfulJob(jobs, (job) => job.type === "trendyol.sync");
    const lastGibFollowupAt = isoDate(latestGib?.updatedAt);
    const lastTrendyolSyncAt = isoDate(latestTrendyol?.updatedAt);
    const staleReason = this.automationStaleReason(now, latestGib, latestTrendyol);

    return {
      budgetGuardMode: AUTOMATION_BUDGET_GUARD_MODE,
      lastGibFollowupAt,
      lastTrendyolSyncAt,
      nextGibFollowupAt: nextScheduledGibFollowupAt(now),
      isStale: Boolean(staleReason),
      staleReason,
      autoRunsToday: this.autoRunsTodayFromJobs(jobs, now),
      dailyAutoRunLimit: this.dailyAutoRunLimit(),
      manualRunAllowed: true
    };
  }

  async runNextJob(id: string) {
    const job = await this.prisma.integrationJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Islem bulunamadi.");
    if (job.status === JobStatus.SUCCESS || job.status === JobStatus.FAILED) return mapJob(job);

    try {
      if (job.type === "trendyol.sync") return this.runNextTrendyolJob(job);
      if (job.type === "gib-portal.apply") return this.runNextGibPortalApplyJob(job);
      if (job.type === "gib-portal.followup") return this.runNextGibPortalFollowupJob(job);
      if (job.type === "automation.catchup") return this.runNextAutomationCatchupJob(job);
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

  private dailyAutoRunLimit() {
    return nonNegativeIntEnv("SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT", DEFAULT_DAILY_AUTO_RUN_LIMIT);
  }

  private autoRunsTodayFromJobs(jobs: any[], now = new Date()) {
    const todayKey = istanbulDateKey(now);
    return jobs
      .filter((job) => job.type === "gib-portal.followup" && job.target === SCHEDULED_GIB_FOLLOWUP_TARGET)
      .filter((job) => istanbulDateKey(new Date(dateMs(job.updatedAt ?? job.createdAt))) === todayKey)
      .reduce((sum, job) => sum + Math.max(0, Number(job.attempts ?? 0)), 0);
  }

  private async scheduledAutoRunsToday(now = new Date()) {
    const jobs = await this.prisma.integrationJob.findMany({
      where: {
        type: "gib-portal.followup",
        target: SCHEDULED_GIB_FOLLOWUP_TARGET
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200
    });
    return this.autoRunsTodayFromJobs(jobs, now);
  }

  private async automationBudgetGuard(now = new Date()) {
    const dailyAutoRunLimit = this.dailyAutoRunLimit();
    const autoRunsToday = dailyAutoRunLimit <= 0 ? 0 : await this.scheduledAutoRunsToday(now);
    return {
      paused: autoRunsToday >= dailyAutoRunLimit,
      budgetGuardMode: AUTOMATION_BUDGET_GUARD_MODE,
      autoRunsToday,
      dailyAutoRunLimit,
      manualRunAllowed: true
    };
  }

  private selectReusableGibFollowupJob(activeJobs: any[], input: { startDate: string; endDate: string }, now = new Date()) {
    return activeJobs.find((job) => isCurrentGibFollowupJob(job, input)) ?? activeJobs.find((job) => isRecentActiveJob(job, now)) ?? null;
  }

  private async markExpiredGibFollowupJobs(activeJobs: any[], reusableJobId: string | undefined, now = new Date()) {
    const expiredJobs = activeJobs.filter((job) => job.id !== reusableJobId && !isRecentActiveJob(job, now));
    for (const expiredJob of expiredJobs) {
      await this.prisma.integrationJob.update({
        where: { id: expiredJob.id },
        data: {
          status: JobStatus.FAILED,
          lastError: "GIB takip isi 48 saatten uzun suredir tamamlanamadi; yeni is beklemeden ilerleyecek.",
          response: {
            ...stripLargeJobResponse(jsonRecord(expiredJob.response)),
            message: "Eski GIB takip isi 48 saatten uzun suredir tamamlanamadi; veri silinmedi, yeni takip isi devam edebilir."
          } as Prisma.InputJsonValue
        }
      });
    }
  }

  private async findOrCreateGibFollowupJob(target: string, input: { startDate: string; endDate: string }, message: string, now = new Date()) {
    const activeJobs = await this.prisma.integrationJob.findMany({
      where: {
        type: "gib-portal.followup",
        target,
        status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] }
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 10
    });
    const reusableJob = this.selectReusableGibFollowupJob(activeJobs, input, now);
    await this.markExpiredGibFollowupJobs(activeJobs, reusableJob?.id, now);
    if (reusableJob) return reusableJob;

    return this.prisma.integrationJob.create({
      data: {
        type: "gib-portal.followup",
        target,
        status: JobStatus.PENDING,
        payload: {
          kind: "gib-portal-followup",
          phase: "gib-apply",
          input
        } as Prisma.InputJsonValue,
        response: {
          message
        } as Prisma.InputJsonValue
      }
    });
  }

  private async pauseGibFollowupJob(job: any, guard: JsonRecord) {
    const updated = await this.prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.PENDING,
        lastError: null,
        response: {
          ...stripLargeJobResponse(jsonRecord(job.response)),
          budgetGuard: guard,
          message: "Butce koruma nedeniyle otomatik GIB takibi beklemede. Veri silinmedi; manuel guncelleme kullanilabilir."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(updated);
  }

  private latestSuccessfulJob(jobs: any[], predicate: (job: any) => boolean) {
    return jobs
      .filter((job) => job.status === JobStatus.SUCCESS && predicate(job))
      .sort((left, right) => dateMs(right.updatedAt) - dateMs(left.updatedAt))[0];
  }

  private automationStaleReason(now: Date, latestGib: any | undefined, latestTrendyol: any | undefined) {
    if (!latestGib) return "GIB otomatik takip henuz basarili tamamlanmadi.";
    if (!latestTrendyol) return "Trendyol fatura izi henuz basarili yenilenmedi.";

    const staleAfterMs = GIB_FOLLOWUP_STALE_HOURS * HOUR_MS;
    const gibAge = now.getTime() - dateMs(latestGib.updatedAt);
    const trendyolAge = now.getTime() - dateMs(latestTrendyol.updatedAt);
    if (gibAge > staleAfterMs) return "Son GIB otomatik takip kontrolu 8 saatten eski.";
    if (trendyolAge > staleAfterMs) return "Son Trendyol fatura izi kontrolu 8 saatten eski.";
    return null;
  }

  async runScheduledGibFollowup() {
    const now = new Date();
    const followupInput = scheduledGibFollowupInput(now);
    const job = await this.findOrCreateGibFollowupJob(
      SCHEDULED_GIB_FOLLOWUP_TARGET,
      followupInput,
      "Son 7 gun GIB portal imza/PDF/Trendyol takibi baslatildi.",
      now
    );
    const guard = await this.automationBudgetGuard(now);
    if (guard.paused) return this.pauseGibFollowupJob(job, guard);

    return this.runNextJob(job.id);
  }

  private async runNextGibPortalFollowupJob(job: any) {
    const step = await this.externalInvoices.runGibPortalFollowupJobStep(jsonRecord(job.payload), stripLargeJobResponse(jsonRecord(job.response)));
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

  private async runNextAutomationCatchupJob(job: any) {
    const payload = jsonRecord(job.payload);
    const response = stripLargeJobResponse(jsonRecord(job.response));
    const phase = typeof payload.phase === "string" ? payload.phase : "trendyol-sync";

    if (phase === "trendyol-sync") {
      const trendyolJobId = typeof payload.trendyolJobId === "string" ? payload.trendyolJobId : undefined;

      if (!trendyolJobId) {
        const trendyolJob = await this.startTrendyolSyncJob();
        const updated = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.PROCESSING,
            attempts: job.attempts + 1,
            payload: {
              ...payload,
              phase: "trendyol-sync",
              trendyolJobId: trendyolJob.id
            } as Prisma.InputJsonValue,
            response: {
              ...response,
              trendyolJobId: trendyolJob.id,
              message: "Trendyol fatura izi guncellemesi baslatildi; islem kaybi olmadan devam edecek."
            } as Prisma.InputJsonValue
          }
        });
        return mapJob(updated);
      }

      const trendyolJob = await this.runNextJob(trendyolJobId);
      if (trendyolJob.status === JobStatus.FAILED) {
        const failed = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            attempts: job.attempts + 1,
            lastError: trendyolJob.lastError ?? "Trendyol fatura izi guncellemesi tamamlanamadi.",
            response: {
              ...response,
              trendyolJobId,
              trendyolStatus: trendyolJob.status,
              message: trendyolJob.lastError ?? "Trendyol fatura izi guncellemesi tamamlanamadi."
            } as Prisma.InputJsonValue
          }
        });
        return mapJob(failed);
      }

      if (trendyolJob.status !== JobStatus.SUCCESS) {
        const updated = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.PROCESSING,
            attempts: job.attempts + 1,
            response: {
              ...response,
              trendyolJobId,
              trendyolStatus: trendyolJob.status,
              message: "Trendyol fatura izi guncelleniyor; manuel otomasyon job'i kayitli kalacak."
            } as Prisma.InputJsonValue
          }
        });
        return mapJob(updated);
      }

      const updated = await this.prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.PROCESSING,
          attempts: job.attempts + 1,
          payload: {
            ...payload,
            phase: "gib-followup",
            trendyolJobId,
            gibJobId: undefined
          } as Prisma.InputJsonValue,
          response: {
            ...response,
            trendyolJobId,
            trendyolStatus: trendyolJob.status,
            externalInvoicesImported: trendyolJob.response?.externalInvoicesImported,
            externalInvoicesMatched: trendyolJob.response?.externalInvoicesMatched,
            message: "Trendyol fatura izi tamamlandi; GIB son 7 gun takip adimina geciliyor."
          } as Prisma.InputJsonValue
        }
      });
      return mapJob(updated);
    }

    if (phase === "gib-followup") {
      const gibJobId = typeof payload.gibJobId === "string" ? payload.gibJobId : undefined;

      if (!gibJobId) {
        const gibJob = await this.findOrCreateGibFollowupJob(
          MANUAL_GIB_FOLLOWUP_TARGET,
          scheduledGibFollowupInput(),
          "Manuel guncelleme icin son 7 gun GIB portal takibi baslatildi."
        );
        const updated = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.PROCESSING,
            attempts: job.attempts + 1,
            payload: {
              ...payload,
              phase: "gib-followup",
              gibJobId: gibJob.id
            } as Prisma.InputJsonValue,
            response: {
              ...response,
              gibJobId: gibJob.id,
              message: "GIB son 7 gun takip/promote adimi baslatildi."
            } as Prisma.InputJsonValue
          }
        });
        return mapJob(updated);
      }

      const gibJob = await this.runNextJob(gibJobId);
      if (gibJob.status === JobStatus.FAILED) {
        const failed = await this.prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            attempts: job.attempts + 1,
            lastError: gibJob.lastError ?? "GIB takip adimi tamamlanamadi.",
            response: {
              ...response,
              gibJobId,
              gibStatus: gibJob.status,
              message: gibJob.lastError ?? "GIB takip adimi tamamlanamadi."
            } as Prisma.InputJsonValue
          }
        });
        return mapJob(failed);
      }

      const done = gibJob.status === JobStatus.SUCCESS;
      const updated = await this.prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: done ? JobStatus.SUCCESS : JobStatus.PROCESSING,
          attempts: job.attempts + 1,
          payload: {
            ...payload,
            phase: done ? "done" : "gib-followup",
            gibJobId
          } as Prisma.InputJsonValue,
          response: {
            ...response,
            ...stripLargeJobResponse(jsonRecord(gibJob.response)),
            gibJobId,
            gibStatus: gibJob.status,
            message: done
              ? "Manuel otomasyon guncellemesi tamamlandi: Trendyol izi ve GIB takip adimlari calisti."
              : "GIB takip/promote adimi devam ediyor; job kayitli kalacak."
          } as Prisma.InputJsonValue
        }
      });
      return mapJob(updated);
    }

    const completed = await this.prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        payload: {
          ...payload,
          phase: "done"
        } as Prisma.InputJsonValue,
        response: {
          ...response,
          message: "Manuel otomasyon guncellemesi tamamlandi."
        } as Prisma.InputJsonValue
      }
    });
    return mapJob(completed);
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
