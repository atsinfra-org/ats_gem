import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import type { Prisma, SavedSearch } from '../generated/prisma/client';
import type { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import type { UpdateSavedSearchDto } from './dto/update-saved-search.dto';

@Injectable()
export class SavedSearchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(organizationId: string, userId: string, dto: CreateSavedSearchDto): Promise<SavedSearch> {
    return this.prisma.savedSearch.create({
      data: { organizationId, createdBy: userId, name: dto.name, criteria: dto.criteria as Prisma.InputJsonValue, alertFrequency: dto.alertFrequency ?? 'OFF' },
    });
  }

  list(organizationId: string): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  async update(organizationId: string, id: string, dto: UpdateSavedSearchDto): Promise<SavedSearch> {
    await this.requireOwnedByOrg(organizationId, id);
    return this.prisma.savedSearch.update({
      where: { id },
      data: { name: dto.name, isActive: dto.isActive, alertFrequency: dto.alertFrequency, criteria: dto.criteria as Prisma.InputJsonValue | undefined },
    });
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireOwnedByOrg(organizationId, id);
    await this.prisma.savedSearch.delete({ where: { id } });
  }

  private async requireOwnedByOrg(organizationId: string, id: string): Promise<void> {
    const savedSearch = await this.prisma.savedSearch.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!savedSearch) throw new AppError('SAVED_SEARCH_NOT_FOUND', 'Saved search not found.');
  }
}
