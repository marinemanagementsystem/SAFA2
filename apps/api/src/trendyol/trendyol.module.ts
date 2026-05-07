import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { TrendyolService } from "./trendyol.service";

@Module({
  imports: [SettingsModule],
  providers: [TrendyolService],
  exports: [TrendyolService]
})
export class TrendyolModule {}
