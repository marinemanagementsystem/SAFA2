import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobsService } from "./jobs.service";

const now = new Date("2026-06-01T10:30:00+03:00");

function integrationJob(input: Partial<any> = {}) {
  const createdAt = input.createdAt ?? new Date("2026-06-01T06:00:00.000Z");
  const updatedAt = input.updatedAt ?? createdAt;
  return {
    id: "job-1",
    type: "gib-portal.followup",
    target: "scheduled-gib-followup",
    status: JobStatus.PENDING,
    attempts: 0,
    lastError: null,
    payload: {
      kind: "gib-portal-followup",
      phase: "gib-apply",
      input: {
        startDate: "2026-05-26T00:00:00+03:00",
        endDate: "2026-06-01T23:59:59+03:00"
      }
    },
    response: { message: "Son 7 gun GIB portal imza/PDF/Trendyol takibi baslatildi." },
    createdAt,
    updatedAt,
    ...input
  };
}

function createService() {
  vi.stubEnv("QUEUE_MODE", "sync");

  const prisma = {
    integrationJob: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    invoiceDraft: {
      findMany: vi.fn()
    }
  };
  const externalInvoices = {
    runGibPortalFollowupJobStep: vi.fn(),
    runGibPortalApplyJobStep: vi.fn(),
    syncTrendyolMetadata: vi.fn()
  };
  const trendyol = {
    fetchDeliveredPackagePage: vi.fn()
  };
  const orders = {
    syncDeliveredOrderPackages: vi.fn()
  };
  const invoices = {
    issueDraft: vi.fn()
  };

  const service = new JobsService(prisma as any, invoices as any, orders as any, externalInvoices as any, trendyol as any);
  return { service, prisma, externalInvoices, trendyol, orders };
}

describe("JobsService automation guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.unstubAllEnvs();
  });

  it("continues a recent unfinished GIB follow-up instead of failing it when the date window shifts", async () => {
    const { service, prisma, externalInvoices } = createService();
    const unfinishedPreviousWindow = integrationJob({
      id: "stale-but-recent",
      payload: {
        kind: "gib-portal-followup",
        phase: "promote-existing",
        input: {
          startDate: "2026-05-25T00:00:00+03:00",
          endDate: "2026-05-31T23:59:59+03:00"
        }
      },
      updatedAt: new Date("2026-06-01T06:00:00.000Z")
    });
    const replacement = integrationJob({ id: "replacement-current-window" });

    prisma.integrationJob.findMany.mockResolvedValue([unfinishedPreviousWindow]);
    prisma.integrationJob.create.mockResolvedValue(replacement);
    prisma.integrationJob.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === unfinishedPreviousWindow.id ? unfinishedPreviousWindow : replacement
    );
    externalInvoices.runGibPortalFollowupJobStep.mockResolvedValue({
      done: false,
      payload: unfinishedPreviousWindow.payload,
      response: { checkedCount: 3 },
      message: "Eski GIB takip isi kayipsiz devam ediyor."
    });
    prisma.integrationJob.update.mockImplementation(async ({ where, data }: any) => ({
      ...unfinishedPreviousWindow,
      id: where.id,
      ...data,
      updatedAt: new Date()
    }));

    const result = await service.runScheduledGibFollowup();

    expect(result.id).toBe(unfinishedPreviousWindow.id);
    expect(prisma.integrationJob.create).not.toHaveBeenCalled();
    expect(prisma.integrationJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: JobStatus.FAILED })
      })
    );
    expect(externalInvoices.runGibPortalFollowupJobStep).toHaveBeenCalledWith(
      unfinishedPreviousWindow.payload,
      expect.any(Object)
    );
  });

  it("pauses automatic GIB follow-up without deleting work when the daily free-tier guard is exhausted", async () => {
    vi.stubEnv("SAFA_AUTOMATION_DAILY_AUTO_RUN_LIMIT", "0");
    const { service, prisma, externalInvoices } = createService();
    const paused = integrationJob({
      id: "budget-paused",
      status: JobStatus.PENDING,
      response: {
        message: "Butce koruma nedeniyle otomatik GIB takibi beklemede.",
        budgetGuard: {
          paused: true,
          dailyAutoRunLimit: 0,
          autoRunsToday: 0
        }
      }
    });

    prisma.integrationJob.findMany.mockResolvedValue([]);
    prisma.integrationJob.create.mockResolvedValue(paused);
    prisma.integrationJob.findUnique.mockResolvedValue(paused);
    prisma.integrationJob.update.mockResolvedValue(paused);

    const result = await service.runScheduledGibFollowup();

    expect(result.status).toBe(JobStatus.PENDING);
    expect(result.response?.budgetGuard).toEqual(
      expect.objectContaining({
        paused: true,
        dailyAutoRunLimit: 0
      })
    );
    expect(externalInvoices.runGibPortalFollowupJobStep).not.toHaveBeenCalled();
  });

  it("reuses an active manual catch-up job instead of creating duplicate all-automation runs", async () => {
    const { service, prisma } = createService();
    const activeCatchup = integrationJob({
      id: "manual-catchup",
      type: "automation.catchup",
      target: "manual-catchup",
      payload: { kind: "automation-catchup", phase: "trendyol-sync" },
      response: { message: "Manuel otomasyon guncellemesi devam ediyor." }
    });

    prisma.integrationJob.findMany.mockResolvedValue([activeCatchup]);

    const result = await (service as any).startAutomationRunNowJob();

    expect(result.id).toBe(activeCatchup.id);
    expect(prisma.integrationJob.create).not.toHaveBeenCalled();
  });

  it("reports free-tier automation status with last updates and the next scheduled GIB run", async () => {
    const { service, prisma } = createService();
    const gibSuccess = integrationJob({
      id: "gib-success",
      status: JobStatus.SUCCESS,
      attempts: 2,
      updatedAt: new Date("2026-06-01T06:10:00.000Z")
    });
    const trendyolSuccess = integrationJob({
      id: "trendyol-success",
      type: "trendyol.sync",
      target: "trendyol",
      status: JobStatus.SUCCESS,
      attempts: 1,
      updatedAt: new Date("2026-06-01T05:40:00.000Z")
    });
    prisma.integrationJob.findMany.mockResolvedValue([gibSuccess, trendyolSuccess]);

    const status = await (service as any).automationStatus();

    expect(status).toEqual(
      expect.objectContaining({
        budgetGuardMode: "free-tier-guard",
        dailyAutoRunLimit: 4,
        manualRunAllowed: true,
        autoRunsToday: 2,
        lastGibFollowupAt: gibSuccess.updatedAt.toISOString(),
        lastTrendyolSyncAt: trendyolSuccess.updatedAt.toISOString(),
        nextGibFollowupAt: "2026-06-01T13:00:00+03:00",
        isStale: false,
        staleReason: null
      })
    );
  });
});
