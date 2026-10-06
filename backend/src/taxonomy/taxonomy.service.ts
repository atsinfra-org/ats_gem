import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  listStates() {
    return this.prisma.state.findMany({ orderBy: { name: 'asc' } });
  }

  listCategories() {
    return this.prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  /** Active sources only, and only what a filter needs - never crawl config or credentials. */
  listSources() {
    return this.prisma.tenderSource.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
  }

  listDistricts(stateCode?: string) {
    return this.prisma.district.findMany({ where: stateCode ? { stateCode } : undefined, select: { id: true, name: true, stateCode: true }, orderBy: { name: 'asc' }, take: 1000 });
  }

  listTenderTypes() {
    return this.prisma.tenderType.findMany({ orderBy: { key: 'asc' } });
  }
}
