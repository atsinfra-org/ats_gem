import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';
import { deletePrefix } from './support/redis';

const redisUp = inject('redisUp');

describe.skipIf(!redisUp)('Auth endpoint rate limiting (e2e, PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_AUTH_MAX: 3, RATE_LIMIT_AUTH_WINDOW_MINUTES: 15 }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await deletePrefix('rate-limit');
  });

  afterAll(() => app?.close());

  it('returns 429 RATE_LIMITED with Retry-After once the per-IP limit is exceeded, and reports the headers', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(201);
      expect(res.headers['ratelimit-limit']).toBe('3');
      expect(res.headers['ratelimit-remaining']).toBe(String(3 - i));
    }
    const limited = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits register too, but each endpoint has its own allowance', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ name: 'User', email: `rl-user-${i}@example.com`, password: 'correct-horse-battery', acceptTerms: true })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'User', email: 'rl-user-4@example.com', password: 'correct-horse-battery', acceptTerms: true })
      .expect(429);
    // forgot-password has its own counter and is unaffected by register's exhaustion.
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(201);
  });

  it('does not limit routes that are not decorated', async () => {
    for (let i = 0; i < 6; i++) await request(app.getHttpServer()).get('/api/v1/meta/tender-types').expect(200);
  });
});
