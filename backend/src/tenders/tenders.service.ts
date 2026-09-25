import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ApiPayload } from '../common/http/api-response';
import { toMoney } from '../common/money';
import { PrismaService } from '../database/prisma.service';
import type { Prisma, Tender } from '../generated/prisma/client';
import type { ListTendersQueryDto } from './dto/list-tenders.query.dto';

type TenderWithTaxonomy = Tender & {
  category: { id: string; name: string } | null;
  subCategory: { id: string; name: string } | null;
  tenderType: { key: string; name: string } | null;
  procuringEntity: { id: string; name: string; entityType: string } | null;
};

const TAXONOMY_INCLUDE = {
  category: { select: { id: true, name: true } },
  subCategory: { select: { id: true, name: true } },
  tenderType: { select: { key: true, name: true } },
  procuringEntity: { select: { id: true, name: true, entityType: true } },
} satisfies Prisma.TenderInclude;

/** Detail response previews are capped (docs/ARCHITECTURE.md Sec 30 "no unbounded relations"); the
 * dedicated, fully paginated endpoints (`/documents`, `/requirements`, `/timeline`, `/corrigenda`)
 * are the source of truth for anything beyond this preview size. */
const DETAIL_PREVIEW_LIMIT = 20;

const DETAIL_INCLUDE = {
  ...TAXONOMY_INCLUDE,
  versions: { orderBy: { version: 'desc' as const }, take: DETAIL_PREVIEW_LIMIT, select: { version: true, changeType: true, diff: true, detectedAt: true } },
  qualityIssues: { where: { resolvedAt: null }, select: { severity: true, code: true, message: true, detectedAt: true } },
  documents: {
    where: { deletedAt: null },
    take: DETAIL_PREVIEW_LIMIT,
    orderBy: [{ documentType: 'asc' as const }, { version: 'desc' as const }],
    select: { id: true, documentType: true, fileName: true, version: true, status: true, sourceUrl: true, createdAt: true },
  },
  requirements: {
    take: DETAIL_PREVIEW_LIMIT,
    orderBy: [{ type: 'asc' as const }, { createdAt: 'asc' as const }],
    select: { id: true, type: true, title: true, description: true, value: true, unit: true, isMandatory: true },
  },
  events: {
    take: DETAIL_PREVIEW_LIMIT,
    orderBy: [{ eventAt: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'asc' as const }],
    select: { id: true, eventType: true, eventAt: true, title: true, description: true },
  },
  corrigenda: {
    take: DETAIL_PREVIEW_LIMIT,
    orderBy: { publishedAt: 'desc' as const },
    select: { id: true, title: true, description: true, publishedAt: true, effectiveAt: true, sourceUrl: true, affectedFields: true },
  },
  sourceRecords: {
    select: { sourceId: true, sourceUrl: true, firstSeenAt: true, lastSeenAt: true, lastChangedAt: true },
  },
} satisfies Prisma.TenderInclude;

/** Anonymous callers see only the first, capped page (docs/API-CONTRACT.md §5). */
const ANONYMOUS_PAGE_SIZE_CAP = 20;

@Injectable()
export class TendersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListTendersQueryDto, viewerId: string | undefined) {
    const page = viewerId ? (query.page ?? 1) : 1;
    const pageSize = viewerId ? (query.pageSize ?? 20) : Math.min(query.pageSize ?? ANONYMOUS_PAGE_SIZE_CAP, ANONYMOUS_PAGE_SIZE_CAP);
    const where = this.buildWhere(query);

    // Two independent reads, not a `$transaction([...])` batch: a search page's count and rows
    // never need to be transactionally consistent with each other, and running them concurrently
    // via `Promise.all` on Prisma 7.10's pg adapter has been observed to trip the driver's
    // "client.query() while already executing a query" deprecation warning — harmless, but avoided
    // by keeping them sequential (a search request is not a performance-critical hot path).
    const total = await this.prisma.tender.count({ where });
    const rows = await this.prisma.tender.findMany({
      where,
      include: TAXONOMY_INCLUDE,
      orderBy: { [query.sortBy ?? 'publishedAt']: query.sortOrder ?? 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const savedIds = await this.savedTenderIds(viewerId, rows.map((r) => r.id));
    const data = rows.map((row) => this.toSummary(row, savedIds.has(row.id)));
    return new ApiPayload(data, { pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  }

  async detail(id: string, viewerId: string | undefined) {
    const tender = await this.prisma.tender.findFirst({ where: { id, deletedAt: null }, include: DETAIL_INCLUDE });
    if (!tender) throw new AppError('TENDER_NOT_FOUND', 'Tender not found.');
    const savedIds = await this.savedTenderIds(viewerId, [tender.id]);
    return this.toDetail(tender, savedIds.has(tender.id));
  }

  private buildWhere(query: ListTendersQueryDto): Prisma.TenderWhereInput {
    const where: Prisma.TenderWhereInput = { deletedAt: null };
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    if (query.state) where.stateCode = query.state;
    if (query.category) where.categoryId = query.category;
    if (query.status) where.status = query.status;
    if (query.procuringEntity) where.procuringEntityId = query.procuringEntity;
    if (query.district) where.districtId = query.district;
    if (query.minValue || query.maxValue) {
      where.estimatedValue = { gte: query.minValue, lte: query.maxValue };
    }
    if (query.publishedFrom || query.publishedTo) {
      where.publishedAt = { gte: query.publishedFrom ? new Date(query.publishedFrom) : undefined, lte: query.publishedTo ? new Date(query.publishedTo) : undefined };
    }
    if (query.closingFrom || query.closingTo) {
      where.closingAt = { gte: query.closingFrom ? new Date(query.closingFrom) : undefined, lte: query.closingTo ? new Date(query.closingTo) : undefined };
    }
    return where;
  }

  private async savedTenderIds(viewerId: string | undefined, tenderIds: string[]): Promise<Set<string>> {
    if (!viewerId || tenderIds.length === 0) return new Set();
    const rows = await this.prisma.watchlistItem.findMany({ where: { userId: viewerId, tenderId: { in: tenderIds } }, select: { tenderId: true } });
    return new Set(rows.map((r) => r.tenderId));
  }

  private toSummary(tender: TenderWithTaxonomy, isSaved: boolean) {
    return {
      id: tender.id,
      referenceNumber: tender.referenceNumber,
      title: tender.title,
      department: tender.department,
      procuringEntity: tender.procuringEntity,
      category: tender.category,
      status: tender.status,
      state: tender.stateCode,
      city: tender.city,
      estimatedValue: toMoney(tender.estimatedValue, tender.currency),
      emdAmount: toMoney(tender.emdAmount, tender.currency),
      publishedAt: tender.publishedAt.toISOString(),
      closingAt: tender.closingAt?.toISOString() ?? null,
      isSaved,
    };
  }

  private toDetail(tender: Prisma.TenderGetPayload<{ include: typeof DETAIL_INCLUDE }>, isSaved: boolean) {
    return {
      ...this.toSummary(tender, isSaved),
      description: tender.description,
      subCategory: tender.subCategory,
      tenderType: tender.tenderType,
      procurementType: tender.procurementType,
      locationText: tender.locationText,
      tenderFee: toMoney(tender.tenderFee, tender.currency),
      openingAt: tender.openingAt?.toISOString() ?? null,
      primarySourceUrl: tender.primarySourceUrl,
      sourceStatusRaw: tender.sourceStatusRaw,
      duplicateOfId: tender.duplicateOfId,
      documents: tender.documents.map((d) => ({ id: d.id, documentType: d.documentType, fileName: d.fileName, version: d.version, status: d.status, sourceUrl: d.sourceUrl, createdAt: d.createdAt.toISOString() })),
      requirements: tender.requirements.map((r) => ({ id: r.id, type: r.type, title: r.title, description: r.description, value: r.value?.toString() ?? null, unit: r.unit, isMandatory: r.isMandatory })),
      timeline: tender.events.map((e) => ({ id: e.id, eventType: e.eventType, eventAt: e.eventAt?.toISOString() ?? null, title: e.title, description: e.description })),
      corrigenda: tender.corrigenda.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        publishedAt: c.publishedAt.toISOString(),
        effectiveAt: c.effectiveAt?.toISOString() ?? null,
        sourceUrl: c.sourceUrl,
        affectedFields: c.affectedFields,
      })),
      versions: tender.versions.map((v) => ({ version: v.version, changeType: v.changeType, diff: v.diff, detectedAt: v.detectedAt.toISOString() })),
      qualityIssues: tender.qualityIssues.map((q) => ({ severity: q.severity, code: q.code, message: q.message, detectedAt: q.detectedAt.toISOString() })),
      /** Answers "where did this tender information come from" (docs/ARCHITECTURE.md Sec 22) without
       * a separate per-field provenance table: one entry per source currently tracking this tender. */
      provenance: tender.sourceRecords.map((s) => ({
        sourceId: s.sourceId,
        sourceUrl: s.sourceUrl,
        firstSeenAt: s.firstSeenAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        lastChangedAt: s.lastChangedAt.toISOString(),
      })),
      lastSyncedAt: tender.lastSyncedAt.toISOString(),
    };
  }
}
