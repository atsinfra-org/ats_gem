import { Global, Module } from '@nestjs/common';
import { OutboxCleanupHandler } from './outbox-cleanup.handler';
import { OutboxPublisher, QueueOutboxPublisher } from './outbox.publisher';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

/** Write side of the outbox, available to every process (API, workers, CLI). */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}

/** Relay + cleanup: worker processes only. Several replicas may run it concurrently. */
@Module({
  providers: [{ provide: OutboxPublisher, useClass: QueueOutboxPublisher }, OutboxRelay, OutboxCleanupHandler],
  exports: [OutboxRelay],
})
export class OutboxRelayModule {}
