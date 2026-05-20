import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SettingsModule } from "../settings/settings.module";
import { HepsiburadaController } from "./hepsiburada.controller";
import { HepsiburadaService } from "./hepsiburada.service";

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [HepsiburadaController],
  providers: [HepsiburadaService],
  exports: [HepsiburadaService]
})
export class HepsiburadaModule {}
