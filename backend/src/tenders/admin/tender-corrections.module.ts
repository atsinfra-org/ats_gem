import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { TenderCorrectionsController } from './tender-corrections.controller';
import { TenderCorrectionsService } from './tender-corrections.service';

@Module({
  imports: [AuditModule],
  controllers: [TenderCorrectionsController],
  providers: [TenderCorrectionsService],
  exports: [TenderCorrectionsService],
})
export class TenderCorrectionsModule {}
