import "reflect-metadata";
// Load apps/api/.env before any module reads process.env (the Prisma client and
// the Prisma CLI do this themselves; the Nest runtime does not).
import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/global-exception.filter";

// Ceiling for ingestion payloads; oversized requests are rejected before any
// application logic runs.
const MAX_BODY_BYTES = "64kb";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: MAX_BODY_BYTES });

  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true
  }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`Debugany API listening on http://localhost:${port}/v1`);
}

void bootstrap();
