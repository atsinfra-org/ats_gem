import { mkdir, access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../redis/redis.module';

export type DependencyStatus = 'up' | 'down' | 'not_configured';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs?: number;
  provider?: string;
  message?: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Record<'database' | 'redis' | 'search' | 'storage', DependencyCheck>;
}

const CHECK_TIMEOUT_MS = 2_000;

async function timed(provider: string | undefined, probe: () => Promise<unknown>): Promise<DependencyCheck> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started), provider };
  } catch (err) {
    // Only the error class/message is exposed; connection strings never appear in health output.
    const message = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'check failed';
    return { status: 'down', provider, message };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  uptimeSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  async readiness(): Promise<ReadinessReport> {
    const [database, redis, search, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkSearch(),
      this.checkStorage(),
    ]);
    const checks = { database, redis, search, storage };
    const ready = Object.values(checks).every((c) => c.status !== 'down');
    return { ready, checks };
  }

  checkDatabase(): Promise<DependencyCheck> {
    return timed('postgresql', () => this.prisma.$queryRaw`SELECT 1`);
  }

  checkRedis(): Promise<DependencyCheck> {
    return timed('redis', () =>
      this.redis.status === 'ready'
        ? this.redis.ping()
        : Promise.reject(new Error(`not connected (connection state: ${this.redis.status})`)),
    );
  }

  /** Runs a probe with the same timeout and error sanitizing as the dependency checks. */
  probe(provider: string, fn: () => Promise<unknown>): Promise<DependencyCheck> {
    return timed(provider, fn);
  }

  private checkSearch(): Promise<DependencyCheck> {
    if (this.config.get('SEARCH_PROVIDER') === 'postgres') {
      // Postgres full-text search shares the primary database connection.
      return timed('postgres', () => this.prisma.$queryRaw`SELECT to_tsvector('simple', 'ready') IS NOT NULL AS ok`);
    }
    const url = this.config.get('OPENSEARCH_URL');
    return timed('opensearch', async () => {
      const res = await fetch(new URL('/_cluster/health', url), { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  private checkStorage(): Promise<DependencyCheck> {
    if (this.config.get('STORAGE_DRIVER') === 'local') {
      const dir = resolve(this.config.get('STORAGE_LOCAL_DIR'));
      return timed('local', async () => {
        await mkdir(dir, { recursive: true });
        await access(dir, constants.W_OK);
      });
    }
    // The S3 driver (AWS S3 / R2 / MinIO) is implemented in Phase 6.
    return Promise.resolve({ status: 'not_configured', provider: 's3', message: 'S3 driver arrives in Phase 6' });
  }
}
