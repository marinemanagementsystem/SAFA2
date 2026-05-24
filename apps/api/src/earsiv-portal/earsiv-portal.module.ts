import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { EarsivPortalController, EarsivPortalEscapedController } from "./earsiv-portal.controller";
import { EarsivPortalService } from "./earsiv-portal.service";

@Module({
  imports: [SettingsModule],
  controllers: [EarsivPortalController, EarsivPortalEscapedController],
  providers: [EarsivPortalService],
  exports: [EarsivPortalService]
})
export class EarsivPortalModule {}
