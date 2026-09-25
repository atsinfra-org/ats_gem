import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { inject } from 'vitest';

const redisUp = inject('redisUp');

describe('API foundation (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns the success envelope with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' }, meta: { requestId: expect.any(String) } });
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  it('propagates a client-supplied X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', 'client-req-0001').expect(200);
    expect(res.headers['x-request-id']).toBe('client-req-0001');
    expect(res.body.data).toMatchObject({ status: 'ok', service: expect.any(String) });
  });

  it('GET /health/ready reports every dependency; Redis down is a readiness failure (503)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    if (redisUp) {
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.checks)).toEqual(['database', 'redis', 'search', 'storage']);
    } else {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'redis', status: 'down' })]);
    }
  });

  it('GET /health/live stays 200 even when a dependency is down (liveness ≠ readiness)', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('GET /health/queues reports every queue, or 503 when the queue backend is down', async () => {
    const res = await request(app.getHttpServer()).get('/health/queues');
    if (redisUp) {
      expect(res.status).toBe(200);
      const queues = res.body.data.queues as { queue: string; paused: boolean }[];
      expect(queues).toHaveLength(8);
      expect(queues[0]).toMatchObject({ paused: false, counts: expect.objectContaining({ waiting: 0, failed: 0 }) });
    } else {
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', details: [expect.objectContaining({ field: 'redis' })] });
    }
  });

  it('unknown routes return the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' }, meta: { requestId: expect.any(String) } });
  });

  it('malformed JSON bodies are rejected without parser internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body.error).toEqual({ code: 'BAD_REQUEST', message: 'Malformed JSON request body.' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.info.title).toBe('ATS Gem API');
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/health', '/health/live', '/health/ready', '/health/queues']));
  });
});
