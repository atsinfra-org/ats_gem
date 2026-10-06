import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleCatalog } from './schedule-catalog.service';
import { BullmqSchedulerBackend, SchedulerBackend } from './scheduler.backend';
import { SCHEDULER_OPTIONS, SchedulerService, type SchedulerOptions } from './scheduler.service';

@Module({})
export class SchedulerModule {
  static forRoot(options: SchedulerOptions): DynamicModule {
    return {
      module: SchedulerModule,
      providers: [
        ScheduleCatalog,
        { provide: SchedulerBackend, useClass: BullmqSchedulerBackend },
        { provide: SCHEDULER_OPTIONS, useValue: options },
        SchedulerService,
      ],
      exports: [SchedulerService],
    };
  }
}
