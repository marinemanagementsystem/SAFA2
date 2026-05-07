import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { JobsService } from "./jobs.service";

const issueSchema = z.object({
  draftIds: z.array(z.string().min(1)).min(1)
});

@Controller()
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get("jobs")
  listJobs() {
    return this.jobsService.listJobs();
  }

  @Post("invoices/issue")
  issue(@Body() body: unknown) {
    const parsed = issueSchema.parse(body);
    return this.jobsService.enqueueInvoiceIssue(parsed.draftIds);
  }
}
