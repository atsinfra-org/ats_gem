import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { EmailTransport, maskEmail, type EmailMessage, type SendResult } from './email-transport';

/**
 * Development/test transport: records that an email would have been sent. Logs the template,
 * a masked recipient and the variable *names* only — values can be one-time secrets.
 */
@Injectable()
export class LogEmailTransport extends EmailTransport {
  readonly driver = 'log';

  constructor(private readonly logger: PinoLogger) {
    super();
    this.logger.setContext(LogEmailTransport.name);
  }

  send(message: EmailMessage): Promise<SendResult> {
    const messageId = randomUUID();
    this.logger.info(
      { messageId, template: message.template, to: maskEmail(message.to), variables: Object.keys(message.variables) },
      'email captured by log transport (not delivered)',
    );
    return Promise.resolve({ messageId });
  }
}
