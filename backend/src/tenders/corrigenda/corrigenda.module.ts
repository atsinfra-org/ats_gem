import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { CorrigendaController } from './corrigenda.controller';
import { CorrigendaService } from './corrigenda.service';

@Module({
  imports: [AuditModule],
  controllers: [CorrigendaController],
  providers: [CorrigendaService],
  exports: [CorrigendaService],
})
export class CorrigendaModule {}
