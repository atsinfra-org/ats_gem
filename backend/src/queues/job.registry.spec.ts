import { outboxJobId } from '../outbox/outbox.routes';
import { jobOptionsFor } from './job-options';
import { JOB_DEFINITIONS, JOB_ID_PATTERN, JOB_SCHEMAS, isJobName, type JobName } from './job.registry';
import { ALL_QUEUES, QUEUE_SETTINGS, QueueName } from './queue.constants';
import { producerConnection, workerConnection } from './redis-connection';

const jobNames = Object.keys(JOB_SCHEMAS) as JobName[];
const uuid = '0199a3b2-0000-7000-8000-000000000001';

describe('job registry', () => {
  it('assigns every job to a known queue with settings', () => {
    for (const name of jobNames) {
      expect(ALL_QUEUES).toContain(JOB_DEFINITIONS[name].queue);
      expect(QUEUE_SETTINGS[JOB_DEFINITIONS[name].queue]).toBeDefined();
    }
  });

  it('covers the six required queue families plus maintenance and dead letter', () => {
    expect(ALL_QUEUES).toEqual([
      'crawler.discovery',
      'crawler.tender',
      'document.processing',
      'search.indexing',
      'notifications',
      'email',
      'maintenance',
      'dead-letter',
    ]);
  });

  it('recognizes job names', () => {
    expect(isJobName('crawler.discover-source')).toBe(true);
    expect(isJobName('toString')).toBe(false);
    expect(isJobName('nope')).toBe(false);
  });

  it('validates payloads strictly', () => {
    expect(JOB_SCHEMAS['crawler.discover-source'].safeParse({ sourceId: uuid, trigger: 'MANUAL' }).success).toBe(true);
    expect(JOB_SCHEMAS['crawler.discover-source'].safeParse({ sourceId: 'x', trigger: 'MANUAL' }).success).toBe(false);
    expect(JOB_SCHEMAS['email.send'].safeParse({ to: 'not-an-email', template: 'welcome' }).success).toBe(false);
    expect(JOB_SCHEMAS['email.send'].safeParse({ to: 'a@b.co', template: '../etc' }).success).toBe(false);
    expect(JOB_SCHEMAS['maintenance.outbox-cleanup'].safeParse({ extra: 1 }).success).toBe(false);
  });

  it('never puts the email recipient into log context', () => {
    const ctx = JOB_DEFINITIONS['email.send'].logContext!({ to: 'someone@example.com', template: 'welcome', variables: {} });
    expect(JSON.stringify(ctx)).not.toContain('someone@example.com');
  });
});

describe('job options', () => {
  it('derives retries, exponential backoff with jitter and retention from the queue', () => {
    const opts = jobOptionsFor('crawler.ingest-tender');
    const settings = QUEUE_SETTINGS[QueueName.CRAWLER_TENDER];
    expect(opts.attempts).toBe(settings.attempts);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: settings.backoffMs, jitter: 0.2 });
    expect(opts.removeOnComplete).toEqual({ age: settings.keepCompletedSeconds, count: 10_000 });
    expect(opts.removeOnFail).toEqual({ age: settings.keepFailedSeconds });
  });

  it('does not retry dead-letter records', () => {
    expect(jobOptionsFor('dead-letter.record')).toMatchObject({ attempts: 1, backoff: undefined });
  });
});

describe('job ids', () => {
  it('accepts the deterministic ids the platform generates', () => {
    expect(outboxJobId(uuid, 'search.index-tender')).toMatch(JOB_ID_PATTERN);
    expect(`dlq.crawler.tender.ingest.${uuid}.abc`).toMatch(JOB_ID_PATTERN);
  });

  it('rejects ids BullMQ cannot store safely', () => {
    expect('a:b').not.toMatch(JOB_ID_PATTERN);
    expect('').not.toMatch(JOB_ID_PATTERN);
    expect('x'.repeat(201)).not.toMatch(JOB_ID_PATTERN);
  });
});

describe('redis connection options', () => {
  it('parses credentials, database and TLS from the URL', () => {
    expect(producerConnection('rediss://user:p%40ss@cache.example.com:6380/2')).toMatchObject({
      host: 'cache.example.com',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
    expect(producerConnection('redis://localhost')).toMatchObject({ host: 'localhost', port: 6379, db: 0, tls: undefined });
  });

  it('producers fail fast; workers wait out reconnects', () => {
    expect(producerConnection('redis://localhost')).toMatchObject({ enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    expect(workerConnection('redis://localhost')).toMatchObject({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  });
});
