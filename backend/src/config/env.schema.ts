import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Environment contract for every process (api, worker, scheduler, crawler).
 * Boot fails fast with a readable report when anything here is missing or malformed.
 * Variables for later phases are optional now and become required when their module lands.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('ats-gem-api'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * `pretty` needs the pino-pretty devDependency, so container images (production dependencies only)
   * must log `json`. Unset: pretty in development, json otherwise.
   */
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  CORS_ORIGINS: csv.default([]),
  SWAGGER_ENABLED: booleanString.default(false),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'must be a postgres:// or postgresql:// connection string',
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'must be a redis:// or rediss:// URL',
    }),

  // Queues & background processing
  /** BullMQ key prefix; isolates environments (and test runs) sharing one Redis. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'letters, digits, "_" or "-" only')
    .default('ats'),
  WORKER_QUEUES: csv.default(['*']),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  OUTBOX_RELAY_ENABLED: booleanString.default(true),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  SCHEDULER_SYNC_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  /** Port for the worker/scheduler health server (the API serves health on PORT). 0 = any free port. */
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).optional(),

  EMAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  EMAIL_FROM: z.string().min(3).default('ATS Gem <no-reply@atsgem.example.com>'),

  SEARCH_PROVIDER: z.enum(['postgres', 'opensearch']).default('postgres'),
  OPENSEARCH_URL: z.url().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false),

  FRONTEND_URL: z.url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(report: string) {
    super(`Invalid environment configuration:\n${report}`);
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(raw: Record<string, unknown>): Env {
  // Empty strings from .env templates mean "not set".
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(z.prettifyError(result.error));
  }
  const env = result.data;
  if (env.SEARCH_PROVIDER === 'opensearch' && !env.OPENSEARCH_URL) {
    throw new EnvValidationError('✖ OPENSEARCH_URL is required when SEARCH_PROVIDER=opensearch');
  }
  if (env.STORAGE_DRIVER === 's3' && !(env.S3_BUCKET && env.S3_REGION)) {
    throw new EnvValidationError('✖ S3_BUCKET and S3_REGION are required when STORAGE_DRIVER=s3');
  }
  return env;
}
