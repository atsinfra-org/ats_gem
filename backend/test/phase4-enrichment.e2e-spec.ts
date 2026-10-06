import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/tenders/documents/documents.service';
import { resetDatabase } from './support/database';

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(100))]);

describe('Phase 4 tender enrichment (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tenderId: string;
  let adminToken: string;
  let plainToken: string;

  async function register(email: string) {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name: 'Test User', email, password: 'correct-horse-battery-staple', acceptTerms: true }).expect(201);
    return { userId: res.body.data.user.id as string, email, token: res.body.data.accessToken as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const tender = await prisma.tender.create({
      data: {
        title: 'Construction of a district hospital block',
        publishedAt: new Date('2026-09-01T00:00:00Z'),
        closingAt: new Date('2026-09-20T00:00:00Z'),
        currency: 'INR',
        status: 'CLOSED',
        statusComputedAt: new Date(),
        lastSyncedAt: new Date(),
        lifecycle: 'ACTIVE',
      },
    });
    tenderId = tender.id;

    const admin = await register(`admin-${Math.random().toString(36).slice(2, 8)}@example.com`);
    const plain = await register(`plain-${Math.random().toString(36).slice(2, 8)}@example.com`);
    const superAdminRole = await prisma.role.findFirstOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await prisma.userRole.create({ data: { userId: admin.userId, roleId: superAdminRole.id } });
    // Permissions are re-queried per request (no JWT claim caching - see PermissionsGuard), so the
    // original token already reflects the role granted just above; no re-login needed.
    adminToken = admin.token;
    plainToken = plain.token;
  });

  afterAll(() => app?.close());

  describe('requirements', () => {
    it('creates, lists, updates and deletes a requirement, all audited', async () => {
      const created = await request(app.getHttpServer())
        .post(`/api/v1/tenders/${tenderId}/requirements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'FINANCIAL', title: 'Minimum annual turnover', value: '5000000.00', unit: 'INR', isMandatory: true })
        .expect(201);
      expect(created.body.data.value).toBe('5000000.00');

      const list = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/requirements`).expect(200);
      expect(list.body.data).toHaveLength(1);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/tenders/${tenderId}/requirements/${created.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: '6000000.00' })
        .expect(200);
      expect(updated.body.data.value).toBe('6000000.00');

      await request(app.getHttpServer()).delete(`/api/v1/tenders/${tenderId}/requirements/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const afterDelete = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/requirements`).expect(200);
      expect(afterDelete.body.data).toHaveLength(0);

      const auditRows = await prisma.auditLog.findMany({ where: { resourceType: 'TenderRequirement' } });
      expect(auditRows.map((r) => r.action).sort()).toEqual(['TENDER_REQUIREMENT_CREATED', 'TENDER_REQUIREMENT_DELETED', 'TENDER_REQUIREMENT_UPDATED']);
    });

    it('rejects mutation without tender.update permission', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/tenders/${tenderId}/requirements`)
        .set('Authorization', `Bearer ${plainToken}`)
        .send({ type: 'TECHNICAL', title: 'Some technical requirement' })
        .expect(403);
    });
  });

  describe('timeline', () => {
    it('lists events chronologically, sorting unknown timestamps last', async () => {
      await prisma.tenderEvent.createMany({
        data: [
          { tenderId, eventType: 'PUBLISHED', eventAt: new Date('2026-09-01T00:00:00Z') },
          { tenderId, eventType: 'SUBMISSION_DEADLINE', eventAt: new Date('2026-09-20T00:00:00Z') },
          { tenderId, eventType: 'PRE_BID_MEETING', eventAt: null },
        ],
      });
      const res = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/timeline`).expect(200);
      const events = res.body.data as { eventType: string }[];
      expect(events.map((e) => e.eventType)).toEqual(['PUBLISHED', 'SUBMISSION_DEADLINE', 'PRE_BID_MEETING']);
    });

    it('lets an authorized admin correct an event, with an audit trail', async () => {
      const event = await prisma.tenderEvent.create({ data: { tenderId, eventType: 'PRE_BID_MEETING', eventAt: null } });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tenders/${tenderId}/timeline/${event.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ eventAt: '2026-09-10T10:00:00.000Z' })
        .expect(200);
      expect(res.body.data.eventAt).toBe('2026-09-10T10:00:00.000Z');
      const auditRow = await prisma.auditLog.findFirst({ where: { resourceType: 'TenderEvent', action: 'TENDER_EVENT_CORRECTED' } });
      expect(auditRow).not.toBeNull();
    });
  });

  describe('corrigenda', () => {
    it('creates a corrigendum and a matching timeline event, linked to the tender', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/tenders/${tenderId}/corrigenda`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Extension of bid submission date', publishedAt: '2026-09-15T00:00:00.000Z', affectedFields: ['closingAt'] })
        .expect(201);
      expect(res.body.data.affectedFields).toEqual(['closingAt']);

      const list = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/corrigenda`).expect(200);
      expect(list.body.data).toHaveLength(1);

      const event = await prisma.tenderEvent.findFirst({ where: { tenderId, eventType: 'CORRIGENDUM' } });
      expect(event).not.toBeNull();
    });
  });

  describe('documents', () => {
    it('registers a document, dedupes identical content, and serves metadata + a streamed download', async () => {
      const documentsService = app.get(DocumentsService);
      const first = await documentsService.register({ tenderId, documentType: 'NIT', fileName: 'nit.pdf', data: PDF_BYTES, declaredMimeType: 'application/pdf' });
      const dupe = await documentsService.register({ tenderId, documentType: 'NIT', fileName: 'nit-again.pdf', data: PDF_BYTES, declaredMimeType: 'application/pdf' });
      expect(dupe.id).toBe(first.id);
      expect(await prisma.storedFile.count()).toBe(1);

      const revisedBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('y'.repeat(100))]);
      const second = await documentsService.register({ tenderId, documentType: 'NIT', fileName: 'nit-v2.pdf', data: revisedBytes, declaredMimeType: 'application/pdf' });
      expect(second.version).toBe(2);
      expect(second.supersedesId).toBe(first.id);
      const stillThere = await prisma.tenderDocument.findUnique({ where: { id: first.id } });
      expect(stillThere).not.toBeNull();

      const list = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/documents`).expect(200);
      expect(list.body.data).toHaveLength(2);

      const download = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}/documents/${second.id}/download`).expect(200);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(download.body).equals(revisedBytes)).toBe(true);
    });

    it('rejects a declared content type that does not match the actual file content', async () => {
      const documentsService = app.get(DocumentsService);
      await expect(
        documentsService.register({ tenderId, documentType: 'OTHER', fileName: 'fake.jpg', data: PDF_BYTES, declaredMimeType: 'image/jpeg' }),
      ).rejects.toThrow(/does not match/);
    });
  });

  describe('administrative corrections', () => {
    it('lets an authorized admin correct a canonical field, with a required reason and an audit trail', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/tenders/${tenderId}/correct`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Corrected title after manual review', reason: 'Source had a typo in the title' })
        .expect(200);

      const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
      expect(tender.title).toBe('Corrected title after manual review');

      const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { resourceType: 'Tender', action: 'TENDER_CORRECTED' } });
      expect(auditRow.oldValue).toMatchObject({ reason: 'Source had a typo in the title' });
    });

    it('rejects a correction attempt without the tender.correct permission', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/tenders/${tenderId}/correct`)
        .set('Authorization', `Bearer ${plainToken}`)
        .send({ title: 'Should not apply', reason: 'unauthorized attempt' })
        .expect(403);
    });
  });

  describe('rich tender detail', () => {
    it('includes requirements, timeline, corrigenda and provenance alongside existing Phase 3 fields', async () => {
      await prisma.tenderRequirement.create({ data: { tenderId, type: 'ELIGIBILITY', title: 'MSME registration required' } });
      await prisma.tenderEvent.create({ data: { tenderId, eventType: 'PUBLISHED', eventAt: new Date('2026-09-01T00:00:00Z') } });
      await prisma.tenderCorrigendum.create({ data: { tenderId, title: 'Deadline extended', publishedAt: new Date('2026-09-15T00:00:00Z') } });

      const res = await request(app.getHttpServer()).get(`/api/v1/tenders/${tenderId}`).expect(200);
      expect(res.body.data.requirements).toHaveLength(1);
      expect(res.body.data.timeline).toHaveLength(1);
      expect(res.body.data.corrigenda).toHaveLength(1);
      expect(res.body.data.provenance).toEqual([]);
    });
  });
});
