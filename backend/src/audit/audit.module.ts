import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/** Available to every module without an explicit import (same pattern as OutboxModule). */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
