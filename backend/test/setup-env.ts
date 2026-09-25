import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { resolveTestDatabaseUrl } from './support/test-env';

// E2E tests reuse the developer's .env for connection strings, but always run in test mode, quietly,
// against the isolated *_test database (created and migrated by global-setup.ts).
config({ path: '.env', quiet: true });
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'true';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
// Each test file gets its own BullMQ key space, so suites never see each other's jobs.
process.env.QUEUE_PREFIX = `test-${randomBytes(4).toString('hex')}`;
// Background loops are started explicitly by the suites that need them.
process.env.OUTBOX_RELAY_ENABLED = 'false';
process.env.HEALTH_PORT = '0';
process.env.EMAIL_DRIVER = 'log';
process.env.SEARCH_PROVIDER = 'postgres';
process.env.STORAGE_DRIVER = 'local';
