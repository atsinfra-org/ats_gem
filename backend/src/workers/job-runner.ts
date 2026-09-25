import { UnrecoverableError, type Job } from 'bullmq';
import type { JobEnvelope } from '../queues/job-envelope';
import { PermanentJobError } from '../queues/job-errors';
import { JOB_DEFINITIONS, JOB_SCHEMAS, isJobName, type JobName, type JobPayload } from '../queues/job.registry';
import { runWithCorrelation } from '../common/context/correlation';
import { describeError } from '../common/errors/describe-error';
import type { JobContext, JobHandler, JobResult } from './job-handler';

/** Minimal structured logger surface (satisfied by nestjs-pino's PinoLogger). */
export interface JobLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  runInContext<T>(fn: () => T, options: { bindings: Record<string, unknown> }): T;
}

export interface DeadLetterRecord {
  queue: string;
  jobName: string;
  jobId: string;
  attemptsMade: number;
  failedReason: string;
  failedAt: string;
  payload: unknown;
  correlationId?: string;
}

export interface JobRunnerDeps {
  handlers: ReadonlyMap<JobName, JobHandler>;
  logger: JobLogger;
  deadLetter: (record: DeadLetterRecord) => Promise<void>;
  now?: () => number;
}

function errorSummary(err: unknown): { name: string; message: string } {
  return { name: err instanceof Error ? err.name : 'NonError', message: describeError(err) };
}

/**
 * Executes one BullMQ job: validates the payload, runs the handler inside a logging/correlation
 * context, and turns failures into the right outcome (retry, permanent failure, dead letter).
 * Kept free of BullMQ Worker wiring so it can be unit tested.
 */
export class JobRunner {
  constructor(private readonly deps: JobRunnerDeps) {}

  async run(job: Job<JobEnvelope>): Promise<JobResult> {
    const now = this.deps.now ?? Date.now;
    const maxAttempts = job.opts.attempts ?? 1;
    const attempt = job.attemptsMade + 1;
    const origin = job.data?.meta?.origin;
    const baseCorrelation = job.data?.meta?.correlationId;
    // Scheduled jobs share a template; suffix the job id so each firing is traceable on its own.
    const correlationId =
      origin === 'scheduler' || !baseCorrelation ? `${baseCorrelation ?? 'job'}.${job.id}` : baseCorrelation;

    const bindings: Record<string, unknown> = {
      queue: job.queueName,
      jobName: job.name,
      jobId: job.id,
      attempt,
      maxAttempts,
      correlationId,
    };

    return runWithCorrelation(correlationId, () =>
      this.deps.logger.runInContext(async () => {
        const started = now();
        let isFinalAttempt = attempt >= maxAttempts;
        try {
          if (!isJobName(job.name)) throw new PermanentJobError(`Unknown job name "${job.name}"`);
          const handler = this.deps.handlers.get(job.name);
          if (!handler) throw new PermanentJobError(`No handler registered for "${job.name}" in this process`);

          const parsed = JOB_SCHEMAS[job.name].safeParse(job.data?.payload);
          if (!parsed.success) {
            throw new PermanentJobError(`Invalid payload for "${job.name}": ${parsed.error.issues[0]?.message ?? 'unknown'}`);
          }
          const payload = parsed.data as JobPayload<typeof job.name>;
          Object.assign(bindings, JOB_DEFINITIONS[job.name].logContext?.(payload as never) ?? {});

          this.deps.logger.info({ ...bindings, queuedMs: Math.max(0, started - job.timestamp) }, 'job started');
          const ctx: JobContext = {
            jobId: job.id ?? '',
            queue: job.queueName,
            jobName: job.name,
            attempt,
            maxAttempts,
            isFinalAttempt,
            correlationId,
            job,
          };
          const result = await handler.handle(payload, ctx);
          this.deps.logger.info({ ...bindings, durationMs: now() - started, result: result ?? null }, 'job completed');
          return result;
        } catch (err) {
          const durationMs = now() - started;
          const permanent = err instanceof PermanentJobError || err instanceof UnrecoverableError;
          isFinalAttempt = isFinalAttempt || permanent;
          const error = errorSummary(err);

          if (!isFinalAttempt) {
            this.deps.logger.warn({ ...bindings, durationMs, err: error, willRetry: true }, 'job failed; will retry');
            throw err;
          }

          this.deps.logger.error({ ...bindings, durationMs, err: error, permanent, willRetry: false }, 'job failed permanently');
          await this.deadLetter(job, error, attempt, correlationId);
          // UnrecoverableError tells BullMQ to skip any remaining attempts.
          throw permanent && !(err instanceof UnrecoverableError) ? new UnrecoverableError(error.message) : err;
        }
      }, { bindings }),
    );
  }

  private async deadLetter(job: Job<JobEnvelope>, error: { message: string }, attempt: number, correlationId: string) {
    if (job.name === 'dead-letter.record') return;
    try {
      await this.deps.deadLetter({
        queue: job.queueName,
        jobName: job.name,
        jobId: job.id ?? '',
        attemptsMade: attempt,
        failedReason: error.message,
        failedAt: new Date().toISOString(),
        payload: job.data?.payload,
        correlationId,
      });
    } catch (dlqErr) {
      // The job still ends up in BullMQ's failed set, so nothing is lost if the DLQ write fails.
      this.deps.logger.error({ err: errorSummary(dlqErr), jobId: job.id }, 'dead-letter enqueue failed');
    }
  }
}
