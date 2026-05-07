import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { envBool, envNumber } from "../common/env";
import { OrdersService } from "./orders.service";

@Injectable()
export class OrdersScheduler {
  private readonly logger = new Logger(OrdersScheduler.name);

  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Interval(60_000)
  async tick() {
    if (!envBool("AUTO_SYNC_ENABLED", false)) return;

    const interval = envNumber("AUTO_SYNC_INTERVAL_MS", 900_000);
    const minute = Date.now() % interval;
    if (minute > 60_000) return;

    try {
      await this.ordersService.syncDeliveredOrders();
    } catch (error) {
      this.logger.error(error);
    }
  }
}
