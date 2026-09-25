import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';

export const REDIS = Symbol('REDIS');

const logger = new Logger('Redis');

function createRedis(config: AppConfig): Redis {
  let lastWarning = 0;
  const client = new Redis(config.get('REDIS_URL'), {
    lazyConnect: true,
    // Required by BullMQ for blocking connections; also avoids per-command retry storms.
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });
  client.on('ready', () => logger.log('Connected'));
  client.on('error', (err: Error & { code?: string }) => {
    // Throttle to one warning per 30 s so an absent Redis doesn't flood logs.
    if (Date.now() - lastWarning > 30_000) {
      lastWarning = Date.now();
      logger.warn(`Unavailable (${err.code ?? err.name}): ${err.message || 'connection failed'}; retrying`);
    }
  });
  client.connect().catch(() => undefined);
  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [AppConfig], useFactory: createRedis }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Runs after BeforeApplicationShutdown, i.e. after workers, relays and schedulers have stopped. */
  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
