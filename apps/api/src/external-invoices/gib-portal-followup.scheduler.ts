import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { envBool, envNumber } from "../common/env";
import { ExternalInvoicesService } from "./external-invoices.service";

@Injectable()
export class GibPortalFollowupScheduler {
  private readonly logger = new Logger(GibPortalFollowupScheduler.name);

  constructor(@Inject(ExternalInvoicesService) private readonly externalInvoices: ExternalInvoicesService) {}

  @Interval(60_000)
  async tick() {
    if (!envBool("AUTO_GIB_PORTAL_FOLLOWUP_ENABLED", false)) return;

    const interval = envNumber("AUTO_GIB_PORTAL_FOLLOWUP_INTERVAL_MS", 600_000);
    const minute = Date.now() % interval;
    if (minute > 60_000) return;

    try {
      await this.externalInvoices.applyGibPortalSync({ days: 30 });
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : error);
    }
  }
}
