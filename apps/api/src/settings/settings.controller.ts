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

const gibDirectConnectionSchema = z.object({
  environment: z.enum(["test", "prod"]).default("test"),
  taxId: z.string().min(10),
  serviceUrl: z.string().url(),
  wsdlUrl: z.string().url().optional().or(z.literal("")),
  soapAction: z.string().optional(),
  soapBodyTemplate: z.string().optional(),
  soapBodyTemplatePath: z.string().optional(),
  signerMode: z.enum(["external-command"]).default("external-command"),
  signerCommand: z.string().min(1),
  soapSignerCommand: z.string().min(1),
  invoicePrefix: z.string().min(1).max(3).default("SAF"),
  nextInvoiceSequence: z.coerce.number().int().min(1).default(1),
  unitCode: z.string().min(1).default("C62"),
  defaultBuyerTckn: z.string().min(10).default("11111111111"),
  testAccessConfirmed: z.coerce.boolean().default(false),
  productionAccessConfirmed: z.coerce.boolean().default(false),
  authorizationReference: z.string().optional(),
  clientCertPath: z.string().optional(),
  clientKeyPath: z.string().optional(),
  clientPfxPath: z.string().optional(),
  clientCertPassword: z.string().optional()
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

  @Put("connections/trendyol/connect")
  connectTrendyol(@Body() body: unknown) {
    const parsed = trendyolConnectionSchema.parse(body);
    return this.settingsService.connectTrendyol(parsed);
  }

  @Put("connections/gib-portal")
  saveGibPortal(@Body() body: unknown) {
    const parsed = gibPortalConnectionSchema.parse(body);
    return this.settingsService.saveGibPortalConnection(parsed);
  }

  @Put("connections/gib-portal/connect")
  connectGibPortal(@Body() body: unknown) {
    const parsed = gibPortalConnectionSchema.parse(body);
    return this.settingsService.connectGibPortal(parsed);
  }

  @Put("connections/gib-direct")
  saveGibDirect(@Body() body: unknown) {
    const parsed = gibDirectConnectionSchema.parse(body);
    return this.settingsService.saveGibDirectConnection(parsed);
  }

  @Put("connections/gib-direct/connect")
  connectGibDirect(@Body() body: unknown) {
    const parsed = gibDirectConnectionSchema.parse(body);
    return this.settingsService.connectGibDirect(parsed);
  }
}
