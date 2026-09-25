import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { CorrectTenderDto } from './dto/correct-tender.dto';
import { TenderCorrectionsService } from './tender-corrections.service';

/** Administrative correction of canonical tender fields (docs/ARCHITECTURE.md Sec 19). Permission-gated, audited, reasoned. */
@ApiTags('tender-admin')
@ApiBearerAuth()
@Controller('tenders/:tenderId/correct')
export class TenderCorrectionsController {
  constructor(private readonly corrections: TenderCorrectionsService) {}

  @Patch()
  @HttpCode(200)
  @RequirePermissions('tender.correct')
  async correct(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Body() dto: CorrectTenderDto, @CurrentUser() user: AuthenticatedUser) {
    const { reason, ...changes } = dto;
    await this.corrections.correct(
      tenderId,
      { ...changes, closingAt: changes.closingAt ? new Date(changes.closingAt) : undefined, openingAt: changes.openingAt ? new Date(changes.openingAt) : undefined },
      reason,
      user.id,
    );
    return null;
  }
}
