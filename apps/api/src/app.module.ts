import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "./prisma/prisma.module";
import { TrendyolModule } from "./trendyol/trendyol.module";
import { OrdersModule } from "./orders/orders.module";
import { InvoiceModule } from "./invoice/invoice.module";
import { JobsModule } from "./jobs/jobs.module";
import { SettingsModule } from "./settings/settings.module";
import { EarsivPortalModule } from "./earsiv-portal/earsiv-portal.module";
import { ExternalInvoicesModule } from "./external-invoices/external-invoices.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TrendyolModule,
    OrdersModule,
    InvoiceModule,
    JobsModule,
    SettingsModule,
    EarsivPortalModule,
    ExternalInvoicesModule
  ]
})
export class AppModule {}
