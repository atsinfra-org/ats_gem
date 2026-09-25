import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './api.module';
import { configureApp, SWAGGER_PATH } from './bootstrap/configure-app';
import { AppConfig } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true });
  configureApp(app);

  const config = app.get(AppConfig);
  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
  if (config.get('SWAGGER_ENABLED')) {
    logger.log(`Swagger UI at http://localhost:${port}/${SWAGGER_PATH}`, 'Bootstrap');
  }
}

bootstrap().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid env), so fall back to stderr.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
