import { JobStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { JobsService } from "../src/jobs/jobs.service";

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    type: "trendyol.sync",
    target: "trendyol",
    status: JobStatus.PENDING,
    attempts: 0,
    payload: {
      kind: "trendyol-sync",
      phase: "orders",
      startDate: "2026-05-20T00:00:00.000Z",
      endDate: "2026-05-21T00:00:00.000Z",
      nextCursor: undefined,
      page: 0
    },
    response: {},
    lastError: null,
    createdAt: new Date("2026-05-21T10:00:00.000Z"),
    updatedAt: new Date("2026-05-21T10:00:00.000Z"),
    ...overrides
  };
}

function serviceWith(job = makeJob()) {
  let currentJob = job;
  const prisma = {
    integrationJob: {
      create: vi.fn(async (args) => {
        currentJob = { ...makeJob(), ...args.data, id: "job-1" };
        return currentJob;
      }),
      findUnique: vi.fn(async () => currentJob),
      findMany: vi.fn(async () => [currentJob]),
      update: vi.fn(async (args) => {
        currentJob = { ...currentJob, ...args.data };
        return currentJob;
      })
    }
  };
  const invoiceService = {};
  const orders = {
    syncDeliveredOrderPackages: vi.fn(async () => ({ packageCount: 1, upserted: 1, draftsCreated: 1, draftsUpdated: 0 }))
  };
  const externalInvoices = {
    syncTrendyolMetadata: vi.fn(async () => ({ imported: 1, matched: 1, unmatched: 0, invoices: [{ id: "too-large" }] })),
    runGibPortalApplyJobStep: vi.fn(async () => ({
      payload: { kind: "gib-portal-apply", phase: "done" },
      response: { imported: 2, matched: 2, invoices: [{ id: "too-large" }] },
      done: true,
      message: "GIB apply tamamlandi."
    })),
    runGibPortalFollowupJobStep: vi.fn(async () => ({
      payload: { kind: "gib-portal-followup", phase: "done" },
      response: { pdfSaved: 1, trendyolSent: 1, invoices: [{ id: "too-large" }] },
      done: true,
      message: "GIB takip tamamlandi."
    }))
  };
  const trendyol = {
    fetchDeliveredPackagePage: vi.fn(async () => ({
      content: [{ shipmentPackageId: "pkg-1", orderNumber: "11226054818" }],
      hasMore: false,
      nextCursor: undefined
    }))
  };

  return {
    service: new JobsService(prisma as never, invoiceService as never, orders as never, externalInvoices as never, trendyol as never),
    prisma,
    orders,
    externalInvoices,
    trendyol
  };
}

describe("JobsService long-running integration jobs", () => {
  it("runs the Trendyol job by refreshing orders before importing Trendyol invoice metadata", async () => {
    const { service, prisma, orders, externalInvoices, trendyol } = serviceWith();

    const result = await service.runNextJob("job-1");

    expect(trendyol.fetchDeliveredPackagePage).toHaveBeenCalledTimes(1);
    expect(orders.syncDeliveredOrderPackages).toHaveBeenCalledWith([{ shipmentPackageId: "pkg-1", orderNumber: "11226054818" }]);
    expect(externalInvoices.syncTrendyolMetadata).toHaveBeenCalledWith({ includeInvoices: false });
    expect(prisma.integrationJob.update).toHaveBeenLastCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        response: expect.objectContaining({
          ordersUpserted: 1,
          externalInvoicesImported: 1,
          externalInvoicesMatched: 1
        })
      })
    });
    expect(JSON.stringify(result)).not.toContain("too-large");
  });

  it("runs a GIB apply job step and strips large invoice lists from persisted response", async () => {
    const gibJob = makeJob({
      type: "gib-portal.apply",
      target: "gib-portal",
      payload: {
        kind: "gib-portal-apply",
        phase: "query",
        input: {
          startDate: "2026-05-20T00:00:00+03:00",
          endDate: "2026-05-20T23:59:59+03:00",
          repairMissingDrafts: true
        }
      }
    });
    const { service, prisma, externalInvoices } = serviceWith(gibJob);

    const result = await service.runNextJob("job-1");

    expect(externalInvoices.runGibPortalApplyJobStep).toHaveBeenCalledWith(gibJob.payload, gibJob.response);
    expect(prisma.integrationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        response: expect.not.objectContaining({ invoices: expect.any(Array) })
      })
    });
    expect(JSON.stringify(result)).not.toContain("too-large");
  });

  it("advances an active scheduled GIB follow-up job instead of creating duplicate work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00+03:00"));
    const activeJob = makeJob({
      id: "active-gib-job",
      type: "gib-portal.followup",
      target: "scheduled-gib-followup",
      status: JobStatus.PROCESSING,
      payload: {
        kind: "gib-portal-followup",
        phase: "pdf-missing",
        input: {
          startDate: "2026-05-22T00:00:00+03:00",
          endDate: "2026-05-22T23:59:59+03:00"
        }
      },
      response: {
        message: "PDF bekleyen kayitlar kontrol ediliyor."
      }
    });
    try {
      const { service, prisma, externalInvoices } = serviceWith(activeJob);
      prisma.integrationJob.findMany.mockResolvedValueOnce([activeJob]);

      const result = await service.runScheduledGibFollowup();

      expect(prisma.integrationJob.create).not.toHaveBeenCalled();
      expect(externalInvoices.runGibPortalFollowupJobStep).toHaveBeenCalledWith(activeJob.payload, activeJob.response);
      expect(result.id).toBe("active-gib-job");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops stale scheduled GIB follow-up jobs and creates a today-only job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00+03:00"));
    const staleJob = makeJob({
      id: "stale-gib-job",
      type: "gib-portal.followup",
      target: "scheduled-gib-followup",
      status: JobStatus.PROCESSING,
      payload: {
        kind: "gib-portal-followup",
        phase: "gib-apply",
        input: { days: 30 }
      },
      response: {
        message: "Eski takip isi."
      }
    });
    try {
      const { service, prisma, externalInvoices } = serviceWith(staleJob);
      prisma.integrationJob.findMany.mockResolvedValueOnce([staleJob]);

      await service.runScheduledGibFollowup();

      expect(prisma.integrationJob.update).toHaveBeenCalledWith({
        where: { id: "stale-gib-job" },
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          lastError: expect.stringContaining("scheduler yalnizca bugunu isler")
        })
      });
      expect(prisma.integrationJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "gib-portal.followup",
          target: "scheduled-gib-followup",
          payload: {
            kind: "gib-portal-followup",
            phase: "gib-apply",
            input: {
              startDate: "2026-05-22T00:00:00+03:00",
              endDate: "2026-05-22T23:59:59+03:00"
            }
          }
        })
      });
      expect(externalInvoices.runGibPortalFollowupJobStep).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            startDate: "2026-05-22T00:00:00+03:00",
            endDate: "2026-05-22T23:59:59+03:00"
          }
        }),
        expect.any(Object)
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
