/**
 * Throw from a job handler when retrying cannot help (invalid payload, missing entity, disabled
 * source). The worker fails the job immediately and moves it to the dead-letter queue.
 * Any other error is retried with exponential backoff until the queue's attempts are exhausted.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
