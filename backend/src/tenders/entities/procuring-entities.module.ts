import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { EntityResolutionService } from './entity-resolution.service';
import { ProcuringEntitiesController } from './procuring-entities.controller';
import { ProcuringEntitiesService } from './procuring-entities.service';

@Module({
  imports: [AuditModule],
  controllers: [ProcuringEntitiesController],
  providers: [EntityResolutionService, ProcuringEntitiesService],
  exports: [EntityResolutionService, ProcuringEntitiesService],
})
export class ProcuringEntitiesModule {}
