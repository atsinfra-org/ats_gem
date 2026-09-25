import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config.service';
import { EmailTransport } from './email-transport';
import { LogEmailTransport } from './log-email.transport';
import { SendEmailHandler } from './send-email.handler';

/** Worker-side email delivery. The transport is chosen by EMAIL_DRIVER. */
@Module({
  providers: [
    {
      provide: EmailTransport,
      inject: [AppConfig, PinoLogger],
      useFactory: (config: AppConfig, logger: PinoLogger): EmailTransport => {
        if (config.get('EMAIL_DRIVER') === 'smtp') {
          throw new Error('EMAIL_DRIVER=smtp: SMTP delivery arrives with auth emails in Phase 2. Use EMAIL_DRIVER=log.');
        }
        return new LogEmailTransport(logger);
      },
    },
    SendEmailHandler,
  ],
})
export class EmailModule {}
