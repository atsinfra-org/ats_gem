import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { SearchService } from '../search/search.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDispatchHandler } from './notification-dispatch.handler';
import { NotificationEmailHandler } from './notification-email.handler';
import { NotificationEventProcessor } from './notification-event-processor.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { DeadlineSweepHandler, DigestHandler } from './notification-scheduled.handlers';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SavedSearchMatcherService } from './saved-search-matcher.service';

/** API side: read/update the caller's own notifications and preferences. Generation never happens in an HTTP request. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationPreferencesService],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}

/** Worker side: event -> notification generation, email delivery, deadline sweep and digests. */
@Module({
  imports: [EmailModule],
  providers: [
    SearchService,
    NotificationsService,
    NotificationPreferencesService,
    SavedSearchMatcherService,
    NotificationDeliveryService,
    NotificationEventProcessor,
    NotificationDispatchHandler,
    NotificationEmailHandler,
    DeadlineSweepHandler,
    DigestHandler,
  ],
})
export class NotificationsWorkerModule {}
