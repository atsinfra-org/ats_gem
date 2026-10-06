import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { AppConfig } from '../config/app-config.service';

/**
 * Single Prisma client per process. Connects lazily on first query so the API can boot
 * (and report "not ready") while the database is unavailable, instead of crash-looping.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        max: config.get('DATABASE_POOL_MAX'),
        connectionTimeoutMillis: 5_000,
        // The driver adapter sends timestamps as UTC wall-clock values without an offset, which
        // Postgres interprets in the session time zone. Pinning sessions to UTC keeps values written
        // by Prisma consistent with SQL now() on servers configured for a local zone (e.g. IST).
        options: '-c TimeZone=UTC',
      }),
    });
  }

  /** Runs after BeforeApplicationShutdown, i.e. after workers and relays have drained. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
