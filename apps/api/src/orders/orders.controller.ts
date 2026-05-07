import { Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { OrdersService } from "./orders.service";

@Controller()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Get("orders")
  list() {
    return this.ordersService.listOrders();
  }

  @Get("orders/:id")
  get(@Param("id") id: string) {
    return this.ordersService.getOrderDetail(id);
  }

  @Post("sync/trendyol")
  sync() {
    return this.ordersService.syncDeliveredOrders();
  }
}
