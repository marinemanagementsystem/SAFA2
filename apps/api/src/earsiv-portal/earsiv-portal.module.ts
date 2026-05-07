import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { EarsivPortalController } from "./earsiv-portal.controller";
import { EarsivPortalService } from "./earsiv-portal.service";

@Module({
  imports: [SettingsModule],
  controllers: [EarsivPortalController],
  providers: [EarsivPortalService],
  exports: [EarsivPortalService]
})
export class EarsivPortalModule {}
