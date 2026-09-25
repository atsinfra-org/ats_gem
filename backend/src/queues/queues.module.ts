import { Global, Module } from '@nestjs/common';
import { QueueHealthService } from './queue-health.service';
import { QueueProducer } from './queue.producer';

/** Producer-side queue access. Every process may enqueue; only workers consume (WorkerRuntimeModule). */
@Global()
@Module({
  providers: [QueueProducer, QueueHealthService],
  exports: [QueueProducer, QueueHealthService],
})
export class QueuesModule {}
