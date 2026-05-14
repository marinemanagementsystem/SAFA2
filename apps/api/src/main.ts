import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { apiAuthMiddleware } from "./auth/auth.middleware";

const httpLogger = new Logger("SAFA HTTP");
const SENSITIVE_FIELD_PATTERN = /(password|secret|token|apikey|api_key|authorization|signercommand|clientcert|clientkey|clientpfx)/i;
const defaultCorsOrigins = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.onrender\.com$/,
  "https://safa-8f76e.web.app",
  "https://safa-8f76e.firebaseapp.com"
];
const localNetworkAccessNamePattern = /^[a-z0-9_.-]{1,248}$/;
const localNetworkAccessIdPattern = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;
const defaultLocalNetworkAccessName = "safa-local-api";
const defaultLocalNetworkAccessId = "02:53:41:46:41:32";
const corsAllowedHeaders = [
  "Accept",
  "Authorization",
  "Content-Type",
  "Origin",
  "X-Requested-With",
  "Access-Control-Request-Private-Network",
  "Access-Control-Request-Local-Network",
  "Private-Network-Access-Name",
  "Private-Network-Access-ID"
];

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? "[redacted]" : redactSensitiveValues(item)
    ])
  );
}

function apiRequestLogger(request: Request, response: Response, next: NextFunction) {
  const startedAt = Date.now();
  const { method, originalUrl } = request;

  httpLogger.log(
    JSON.stringify({
      event: "api.request",
      method,
      route: originalUrl,
      query: redactSensitiveValues(request.query),
      requestedAt: new Date(startedAt).toISOString()
    })
  );

  response.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const status = response.statusCode;
    const payload = JSON.stringify({
      event: "api.response",
      method,
      route: originalUrl,
      status,
      durationMs,
      contentLength: response.getHeader("content-length") ?? null,
      respondedAt: new Date().toISOString()
    });

    if (status >= 500) {
      httpLogger.error(payload);
      return;
    }

    if (status >= 400) {
      httpLogger.warn(payload);
      return;
    }

    httpLogger.log(payload);
  });

  next();
}

function privateNetworkHeaderValue(value: string) {
  return JSON.stringify(value);
}

function privateNetworkAccessName() {
  const configured = process.env.PRIVATE_NETWORK_ACCESS_NAME?.trim().toLowerCase();
  return configured && localNetworkAccessNamePattern.test(configured) ? configured : defaultLocalNetworkAccessName;
}

function privateNetworkAccessId() {
  const configured = process.env.PRIVATE_NETWORK_ACCESS_ID?.trim();
  return configured && localNetworkAccessIdPattern.test(configured) ? configured : defaultLocalNetworkAccessId;
}

function privateNetworkCorsMiddleware(request: Request, response: Response, next: NextFunction) {
  const requestHeaders = String(request.headers["access-control-request-headers"] ?? "");
  const allowedHeaders = Array.from(
    new Set(
      [...corsAllowedHeaders, ...requestHeaders.split(",").map((header) => header.trim()).filter(Boolean)].map((header) =>
        header.toLowerCase()
      )
    )
  ).join(", ");

  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Access-Control-Allow-Local-Network", "true");
  response.setHeader("Private-Network-Access-Name", privateNetworkHeaderValue(privateNetworkAccessName()));
  response.setHeader("Private-Network-Access-ID", privateNetworkHeaderValue(privateNetworkAccessId()));
  response.setHeader("Access-Control-Allow-Headers", allowedHeaders);
  response.setHeader("Access-Control-Expose-Headers", "Private-Network-Access-Name, Private-Network-Access-ID");
  response.vary("Origin");
  response.vary("Access-Control-Request-Method");
  response.vary("Access-Control-Request-Headers");
  response.vary("Access-Control-Request-Private-Network");
  response.vary("Access-Control-Request-Local-Network");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
}

function shouldEnablePrivateNetworkCors() {
  if (process.env.ENABLE_PRIVATE_NETWORK_CORS === "true") return true;
  if (process.env.ENABLE_PRIVATE_NETWORK_CORS === "false") return false;
  return process.env.NODE_ENV !== "production" && !process.env.K_SERVICE;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configuredCorsOrigins = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
  const enablePrivateNetworkCors = shouldEnablePrivateNetworkCors();

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: configuredCorsOrigins?.length ? [...configuredCorsOrigins, ...defaultCorsOrigins] : defaultCorsOrigins,
    credentials: true,
    allowedHeaders: corsAllowedHeaders,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
    preflightContinue: enablePrivateNetworkCors
  });
  if (enablePrivateNetworkCors) {
    app.use(privateNetworkCorsMiddleware);
  }
  app.use(apiRequestLogger);
  app.use(apiAuthMiddleware);

  const swaggerConfig = new DocumentBuilder()
    .setTitle("SAFA API")
    .setDescription("Trendyol siparislerinden kontrollu e-Arsiv fatura akisi")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
