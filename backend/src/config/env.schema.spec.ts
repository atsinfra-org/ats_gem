import { EnvValidationError, validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.SEARCH_PROVIDER).toBe('postgres');
    expect(env.WORKER_QUEUES).toEqual(['*']);
  });

  it('parses CSV and boolean strings', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test', SWAGGER_ENABLED: 'true' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('treats empty strings as unset', () => {
    expect(validateEnv({ ...base, OPENSEARCH_URL: '', S3_BUCKET: '' }).OPENSEARCH_URL).toBeUndefined();
  });

  it('rejects a non-postgres DATABASE_URL and names the variable', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a missing REDIS_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(EnvValidationError);
  });

  it('requires OPENSEARCH_URL when the opensearch provider is selected', () => {
    expect(() => validateEnv({ ...base, SEARCH_PROVIDER: 'opensearch' })).toThrow(/OPENSEARCH_URL/);
  });

  it('requires bucket and region when the s3 storage driver is selected', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });
});
