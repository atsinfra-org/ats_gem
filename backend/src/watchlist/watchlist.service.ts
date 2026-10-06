import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import type { WatchlistItem } from '../generated/prisma/client';
import type { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';

@Injectable()
export class WatchlistService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: adding a tender that is already bookmarked returns the existing row rather than erroring. */
  async add(userId: string, dto: AddWatchlistItemDto): Promise<WatchlistItem> {
    const tender = await this.prisma.tender.findFirst({ where: { id: dto.tenderId, deletedAt: null }, select: { id: true } });
    if (!tender) throw new AppError('TENDER_NOT_FOUND', 'Tender not found.');

    const existing = await this.prisma.watchlistItem.findUnique({ where: { userId_tenderId: { userId, tenderId: dto.tenderId } } });
    if (existing) return existing;

    return this.prisma.watchlistItem.create({ data: { userId, tenderId: dto.tenderId, note: dto.note } });
  }

  list(userId: string): Promise<WatchlistItem[]> {
    return this.prisma.watchlistItem.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /** Idempotent: removing a tender that was never bookmarked is a no-op, not an error. */
  async remove(userId: string, tenderId: string): Promise<void> {
    await this.prisma.watchlistItem.deleteMany({ where: { userId, tenderId } });
  }
}
