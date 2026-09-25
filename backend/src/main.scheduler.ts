import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { SchedulerAppModule } from './scheduler-app.module';

async function bootstrap(): Promise<void> {
  process.env.PROCESS_ROLE ??= 'scheduler';
  const app = await NestFactory.createApplicationContext(SchedulerAppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Scheduler started', 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
