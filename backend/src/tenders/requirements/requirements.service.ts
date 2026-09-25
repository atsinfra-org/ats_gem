import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';
import type { RequirementType } from '../../generated/prisma/enums';

export interface UpsertRequirementInput {
  tenderId: string;
  type: RequirementType;
  title: string;
  description?: string;
  value?: string;
  unit?: string;
  isMandatory?: boolean;
  sourceReference?: string;
}

/**
 * Structured requirements CRUD (docs/ARCHITECTURE.md Sec 19). Purely a data model + API - nothing
 * here extracts or infers a requirement from free text; every row is either written by an adapter
 * that read a structured field from the source, or entered by an authorized admin.
 */
@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  list(tenderId: string, params: { type?: RequirementType; take: number; skip: number }) {
    const where = { tenderId, type: params.type };
    return this.prisma.$transaction([
      this.prisma.tenderRequirement.count({ where }),
      this.prisma.tenderRequirement.findMany({ where, orderBy: [{ type: 'asc' }, { createdAt: 'asc' }], take: params.take, skip: params.skip }),
    ]);
  }

  async get(tenderId: string, id: string) {
    const req = await this.prisma.tenderRequirement.findFirst({ where: { id, tenderId } });
    if (!req) throw new AppError('NOT_FOUND', 'Requirement not found.');
    return req;
  }

  async create(input: UpsertRequirementInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.tenderRequirement.create({
        data: {
          tenderId: input.tenderId,
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          value: input.value ?? null,
          unit: input.unit ?? null,
          isMandatory: input.isMandatory ?? true,
          sourceReference: input.sourceReference ?? null,
        },
      });
      await this.audit.record({ actorUserId, action: 'TENDER_REQUIREMENT_CREATED', resourceType: 'TenderRequirement', resourceId: created.id, newValue: { ...created, value: created.value?.toString() ?? null } }, tx);
      return created;
    });
  }

  async update(tenderId: string, id: string, input: Partial<UpsertRequirementInput>, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenderRequirement.findFirst({ where: { id, tenderId } });
      if (!existing) throw new AppError('NOT_FOUND', 'Requirement not found.');
      const updated = await tx.tenderRequirement.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          value: input.value,
          unit: input.unit,
          isMandatory: input.isMandatory,
          sourceReference: input.sourceReference,
        },
      });
      await this.audit.record(
        {
          actorUserId,
          action: 'TENDER_REQUIREMENT_UPDATED',
          resourceType: 'TenderRequirement',
          resourceId: id,
          oldValue: { ...existing, value: existing.value?.toString() ?? null },
          newValue: { ...updated, value: updated.value?.toString() ?? null },
        },
        tx,
      );
      return updated;
    });
  }

  async delete(tenderId: string, id: string, actorUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenderRequirement.findFirst({ where: { id, tenderId } });
      if (!existing) throw new AppError('NOT_FOUND', 'Requirement not found.');
      await tx.tenderRequirement.delete({ where: { id } });
      await this.audit.record(
        { actorUserId, action: 'TENDER_REQUIREMENT_DELETED', resourceType: 'TenderRequirement', resourceId: id, oldValue: { ...existing, value: existing.value?.toString() ?? null } },
        tx,
      );
    });
  }
}
