import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configuredCorsOrigins = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: configuredCorsOrigins?.length
      ? configuredCorsOrigins
      : [/^http:\/\/localhost:\d+$/, /^https:\/\/.*\.onrender\.com$/],
    credentials: true
  });

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
