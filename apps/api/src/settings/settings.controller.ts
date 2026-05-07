import { Body, Controller, Get, Inject, Put } from "@nestjs/common";
import { z } from "zod";
import { SettingsService } from "./settings.service";

const settingsSchema = z.object({
  key: z.string().min(1),
  value: z.unknown()
});

const trendyolConnectionSchema = z.object({
  sellerId: z.string().min(1),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  userAgent: z.string().min(1).default("SAFA local e-arsiv integration"),
  baseUrl: z.string().url().default("https://apigw.trendyol.com"),
  storefrontCode: z.string().min(1).default("TR"),
  lookbackDays: z.coerce.number().int().min(1).max(90).default(14)
});

const gibPortalConnectionSchema = z.object({
  username: z.string().min(1),
  password: z.string().optional(),
  portalUrl: z.string().url().default("https://earsivportal.efatura.gov.tr/intragiris.html")
});

@Controller("settings")
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settingsService: SettingsService) {}

  @Get()
  snapshot() {
    return this.settingsService.snapshot();
  }

  @Put()
  upsert(@Body() body: unknown) {
    const parsed = settingsSchema.parse(body);
    return this.settingsService.upsert(parsed.key, parsed.value);
  }

  @Get("connections")
  connections() {
    return this.settingsService.connections();
  }

  @Put("connections/trendyol")
  saveTrendyol(@Body() body: unknown) {
    const parsed = trendyolConnectionSchema.parse(body);
    return this.settingsService.saveTrendyolConnection(parsed);
  }

  @Put("connections/gib-portal")
  saveGibPortal(@Body() body: unknown) {
    const parsed = gibPortalConnectionSchema.parse(body);
    return this.settingsService.saveGibPortalConnection(parsed);
  }
}
