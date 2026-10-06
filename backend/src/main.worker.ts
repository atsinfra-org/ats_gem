import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './config/app-config.service';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  process.env.PROCESS_ROLE ??= 'worker';
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // SIGTERM/SIGINT → drain in-flight jobs and the outbox relay, then close connections.
  app.enableShutdownHooks();

  const queues = app.get(AppConfig).get('WORKER_QUEUES');
  app.get(Logger).log(`Worker started; queue selection: ${queues.join(', ')}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
