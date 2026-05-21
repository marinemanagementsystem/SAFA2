import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { JobsService } from "./jobs.service";

const issueSchema = z.object({
  draftIds: z.array(z.string().min(1)).min(1)
});

const gibJobSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  repairMissingDrafts: z.boolean().optional(),
  repairOrderNumber: z.string().optional()
});

@Controller()
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get("jobs")
  listJobs() {
    return this.jobsService.listJobs();
  }

  @Get("jobs/:id")
  getJob(@Param("id") id: string) {
    return this.jobsService.getJob(id);
  }

  @Post("jobs/:id/run-next")
  runNextJob(@Param("id") id: string) {
    return this.jobsService.runNextJob(id);
  }

  @Post("sync/trendyol/jobs")
  startTrendyolSyncJob() {
    return this.jobsService.startTrendyolSyncJob();
  }

  @Post("external-invoices/sync/trendyol/jobs")
  startTrendyolExternalInvoiceJob() {
    return this.jobsService.startTrendyolSyncJob();
  }

  @Post("external-invoices/sync/gib-portal/apply/jobs")
  startGibPortalApplyJob(@Body() body: unknown) {
    const parsed = gibJobSchema.parse(body ?? {});
    return this.jobsService.startGibPortalApplyJob(parsed);
  }

  @Post("invoices/issue")
  issue(@Body() body: unknown) {
    const parsed = issueSchema.parse(body);
    return this.jobsService.enqueueInvoiceIssue(parsed.draftIds);
  }
}
