import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { CliModule } from './cli.module';
import { CrawlDispatcher } from './crawler/crawl-dispatcher.service';
import { SeedService } from './database/seed.service';
import { QueueHealthService } from './queues/queue-health.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { SearchIndexService } from './search/search-index.service';
import { SearchEventsPurgeService } from './search/search-events-purge.service';
import { BackfillService } from './tenders/backfill.service';

const USAGE = `Usage: node dist/main.cli.js <command>

Commands:
  seed                 Create default job schedules (and the mock source outside production)
  crawl <slug|id>      Enqueue an on-demand crawl of a tender source
  schedules:sync       Reconcile job_schedules / source schedules into BullMQ once
  queues:status        Print per-queue counts, consumers and latency
  search:reindex [--resume] [--batch N]  Rebuild every tender search vector (idempotent; resumable after a failure)
  search:verify        Compare stored search vectors with a fresh computation (read-only)
  search:purge-events  Delete search analytics events older than SEARCH_EVENT_RETENTION_DAYS (batched, idempotent)
  backfill:phase3      Resolve procuring entities and quality issues for pre-Phase-3 tenders (idempotent)
  backfill:phase4      Seed timeline events and quality issues for pre-Phase-4 tenders (idempotent)`;

type Command = (app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, args: string[]) => Promise<unknown>;

const COMMANDS: Record<string, Command> = {
  seed: (app) => app.get(SeedService).run(),
  crawl: (app, [ref]) => {
    if (!ref) throw new Error('crawl: missing <slug|id>');
    return app.get(CrawlDispatcher).requestCrawl(ref, { origin: 'cli' });
  },
  'schedules:sync': (app) => app.get(SchedulerService).reconcile(),
  'queues:status': (app) => app.get(QueueHealthService).snapshot(),
  'search:reindex': (app, args) => app.get(SearchIndexService).reindex({ resume: args.includes('--resume'), batchSize: Number(args[args.indexOf('--batch') + 1]) || undefined, onProgress: (n) => console.error(`reindexed ${n}`) }),
  'search:verify': (app) => app.get(SearchIndexService).verify(),
  'search:purge-events': (app) => app.get(SearchEventsPurgeService).purge(),
  'backfill:phase3': (app) => app.get(BackfillService).run(),
  'backfill:phase4': (app) => app.get(BackfillService).runPhase4(),
};

async function main(): Promise<void> {
  process.env.PROCESS_ROLE ??= 'cli';
  const [name, ...args] = process.argv.slice(2);
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const app = await NestFactory.createApplicationContext(CliModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  try {
    const result = await command(app, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
