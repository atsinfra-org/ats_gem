import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { CreateSearchEventDto } from './dto/search-event.dto';
import { normalizeQuery } from './query-normalizer';

/** Append-only analytics foundation. Stores the normalized query text and a few structured fields only. */
@Injectable()
export class SearchEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(dto: CreateSearchEventDto, user?: { id: string; organizationId?: string }): Promise<void> {
    // Over-long queries are dropped from analytics rather than truncated into misleading data.
    const queryNormalized = (() => {
      try {
        return normalizeQuery(dto.query)?.text ?? null;
      } catch {
        return null;
      }
    })();
    const payload: Record<string, unknown> = {};
    for (const k of ['name', 'value', 'tenderId', 'position', 'resultCount'] as const) if (dto[k] !== undefined) payload[k] = dto[k];
    await this.prisma.searchEvent.create({
      data: { eventType: dto.type, userId: user?.id ?? null, organizationId: user?.organizationId ?? null, queryNormalized, payload: payload as Prisma.InputJsonValue },
    });
  }
}
