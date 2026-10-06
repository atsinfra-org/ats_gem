import { Injectable } from '@nestjs/common';
import type { JobPayload } from '../queues/job.registry';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { EmailTransport } from './email-transport';

@Injectable()
@JobProcessor('email.send')
export class SendEmailHandler implements JobHandler<'email.send'> {
  constructor(private readonly transport: EmailTransport) {}

  async handle(payload: JobPayload<'email.send'>): Promise<JobResult> {
    const { messageId } = await this.transport.send(payload);
    // The recipient is deliberately not part of the job result (results are stored in Redis and logged).
    return { driver: this.transport.driver, messageId, template: payload.template };
  }
}
