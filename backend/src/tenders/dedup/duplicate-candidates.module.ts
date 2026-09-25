import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { DuplicateCandidatesController } from './duplicate-candidates.controller';
import { DuplicateCandidatesService } from './duplicate-candidates.service';

@Module({
  imports: [AuditModule],
  controllers: [DuplicateCandidatesController],
  providers: [DuplicateCandidatesService],
  exports: [DuplicateCandidatesService],
})
export class DuplicateCandidatesModule {}
