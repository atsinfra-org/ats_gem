import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { WorkerHost } from './worker-host.service';

/** Consumer runtime. Imported only by worker processes, never by the API. */
@Module({
  imports: [DiscoveryModule],
  providers: [WorkerHost],
  exports: [WorkerHost],
})
export class WorkerRuntimeModule {}
