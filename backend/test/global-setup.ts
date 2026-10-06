import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { redisAvailable } from './support/redis';
import { databaseName, resolveTestDatabaseUrl } from './support/test-env';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Whether Redis is reachable; queue suites are skipped without it (unless REQUIRE_REDIS=true). */
    redisUp: boolean;
  }
}

/**
 * Runs once before the e2e suite: creates the isolated test database when missing, applies every
 * Prisma migration to it (the same `migrate deploy` production uses) and probes Redis.
 */
export default async function globalSetup(project: TestProject): Promise<void> {
  config({ path: '.env', quiet: true });
  const testUrl = resolveTestDatabaseUrl();
  const name = databaseName(testUrl);

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  const redisUp = await redisAvailable();
  if (!redisUp) console.warn('\n⚠ Redis is not reachable: queue, scheduler and pipeline suites will be skipped.\n');
  project.provide('redisUp', redisUp);
}
