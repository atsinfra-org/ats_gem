import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { AppConfig } from '../config/app-config.service';
import type { Prisma } from '../generated/prisma/client';
import { QueueName } from '../queues/queue.constants';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, STAFF_ROLE_KEYS } from '../rbac/roles.constants';
import { PrismaService } from './prisma.service';
import { CATEGORY_SEED_DATA, STATE_SEED_DATA, TENDER_TYPE_SEED_DATA } from './seed-data/taxonomy.seed-data';

/** Credentials for the development demo accounts — returned only on the run that creates them. */
export interface DevSeedResult {
  note: string;
  adminEmail: string;
  adminPassword: string;
  memberEmail: string;
  memberPassword: string;
}

export interface SeedResult {
  schedulesCreated: string[];
  sourcesCreated: string[];
  rolesCreated: string[];
  permissionsCreated: string[];
  statesCreated: number;
  tenderTypesCreated: number;
  categoriesCreated: number;
  /** Present only when `NODE_ENV=development` and the demo data did not already exist. */
  devData: DevSeedResult | null;
}

/** Demo accounts use the reserved-for-local-use `.local` TLD, so they can never collide with a real mailbox. */
const DEV_ADMIN_EMAIL = 'admin@dev.atsgem.local';
const DEV_MEMBER_EMAIL = 'member@dev.atsgem.local';

/** Platform schedules every environment needs. Admins may edit or disable them afterwards. */
const DEFAULT_SCHEDULES: Prisma.JobScheduleCreateInput[] = [
  {
    key: 'outbox-cleanup',
    queue: QueueName.MAINTENANCE,
    jobName: 'maintenance.outbox-cleanup',
    cron: '30 3 * * *',
    timezone: 'Asia/Kolkata',
    description: 'Delete relayed outbox events older than OUTBOX_RETENTION_DAYS (daily 03:30 IST).',
  },
  {
    key: 'sources-health-check',
    queue: QueueName.MAINTENANCE,
    jobName: 'maintenance.sources-health-check',
    everyMs: 15 * 60_000,
    description: 'Probe each active tender source adapter and update its health status (every 15 min).',
  },
];

/**
 * The deterministic mock portal used to demonstrate and test the crawl pipeline. Never seeded in
 * production; it cannot reach the network (its URLs use the reserved `.invalid` TLD).
 */
const MOCK_SOURCE: Prisma.TenderSourceCreateInput = {
  name: 'Mock Tender Portal',
  slug: 'mock-portal',
  description: 'Deterministic in-process test source. Contacts no external system.',
  sourceType: 'MOCK',
  adapterKey: 'mock',
  crawlEnabled: true,
  crawlSchedule: '*/30 * * * *',
  crawlTimezone: 'Asia/Kolkata',
  crawlConfig: { mock: { totalTenders: 24, pageSize: 10 } },
};

/** Idempotent: creates missing rows only and never overwrites values an admin has changed. */
@Injectable()
export class SeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Runs sequentially, not via `Promise.all`: seeding is a one-off, low-volume operation where
   * throughput never matters, and running independent Prisma queries concurrently here has been
   * observed to trip Node's "client.query() while already executing a query" pg deprecation
   * warning (harmless in practice — Prisma's connection pool serializes the underlying work — but
   * avoided entirely by not giving the driver a reason to warn about it).
   */
  async run(): Promise<SeedResult> {
    const schedulesCreated = await this.seedSchedules();
    const sourcesCreated = await this.seedMockSource();
    const { rolesCreated, permissionsCreated } = await this.seedRolesAndPermissions();
    const statesCreated = await this.seedStates();
    const tenderTypesCreated = await this.seedTenderTypes();
    const categoriesCreated = await this.seedCategories();
    const devData = await this.seedDevelopmentData();
    return { schedulesCreated, sourcesCreated, rolesCreated, permissionsCreated, statesCreated, tenderTypesCreated, categoriesCreated, devData };
  }

  /**
   * Development-only demo data (admin + member accounts, a shared organization, one sample tender,
   * a saved search and a bookmark), clearly labelled as such. Runs only when `NODE_ENV=development` —
   * never in production or tests. Passwords are randomly generated per run and returned once, never
   * hard-coded or stored anywhere else, so there is no known default credential to leak. Skipped
   * entirely once the admin account exists, so re-seeding never resets a password you already have.
   */
  private async seedDevelopmentData(): Promise<DevSeedResult | null> {
    if (this.config.get('NODE_ENV') !== 'development') return null;
    if (await this.prisma.user.findUnique({ where: { email: DEV_ADMIN_EMAIL }, select: { id: true } })) return null;

    const passwords = new PasswordService();
    const adminPassword = randomBytes(12).toString('base64url');
    const memberPassword = randomBytes(12).toString('base64url');
    const [adminHash, memberHash] = [await passwords.hash(adminPassword), await passwords.hash(memberPassword)];
    const now = new Date();

    const superAdmin = await this.prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' }, select: { id: true } });
    const roadsCategory = await this.prisma.category.findUnique({ where: { slug: 'roads-bridges' }, select: { id: true, parentId: true } });

    await this.prisma.$transaction(async (tx) => {
      const verified = { isEmailVerified: true, termsAcceptedAt: now, termsVersion: 'dev-seed' };
      const admin = await tx.user.create({ data: { email: DEV_ADMIN_EMAIL, name: 'Dev Admin', passwordHash: adminHash, ...verified } });
      const member = await tx.user.create({ data: { email: DEV_MEMBER_EMAIL, name: 'Dev Member', passwordHash: memberHash, ...verified } });
      await tx.userRole.create({ data: { userId: admin.id, roleId: superAdmin.id } });

      const adminOrg = await tx.organization.create({ data: { name: 'Dev Admin Workspace', slug: 'dev-admin-workspace', isPersonal: true } });
      const memberOrg = await tx.organization.create({ data: { name: 'Dev Member Workspace', slug: 'dev-member-workspace', isPersonal: true } });
      await tx.organizationMember.createMany({
        data: [
          { organizationId: adminOrg.id, userId: admin.id, role: 'OWNER' },
          { organizationId: memberOrg.id, userId: member.id, role: 'OWNER' },
          // The demo member also belongs to the admin's organization, as a MEMBER — a ready-made
          // team to try `POST /auth/switch-organization/:organizationId` against.
          { organizationId: adminOrg.id, userId: member.id, role: 'MEMBER' },
        ],
      });

      const tender = await tx.tender.create({
        data: {
          title: '[DEV SEED] Sample road construction tender',
          description: 'Development demo data created by the seed command. Not a real tender.',
          department: 'Dev Seed Department',
          stateCode: 'MH',
          city: 'Pune',
          estimatedValue: '25000000.00',
          currency: 'INR',
          publishedAt: now,
          closingAt: new Date(now.getTime() + 14 * 86_400_000),
          status: 'OPEN',
          statusComputedAt: now,
          lastSyncedAt: now,
          categoryId: roadsCategory?.parentId ? roadsCategory.parentId : roadsCategory?.id,
          subCategoryId: roadsCategory?.parentId ? roadsCategory.id : undefined,
          tenderTypeKey: 'OPEN',
          procurementType: 'WORKS',
        },
      });
      await tx.savedSearch.create({
        data: { organizationId: adminOrg.id, createdBy: admin.id, name: '[DEV SEED] Open tenders in Maharashtra', criteria: { state: 'MH', status: 'OPEN' } },
      });
      await tx.watchlistItem.create({ data: { userId: admin.id, tenderId: tender.id, note: '[DEV SEED] example bookmark' } });
    });

    return {
      note: 'Development demo accounts (NODE_ENV=development only). These passwords are shown once and never stored in plain text.',
      adminEmail: DEV_ADMIN_EMAIL,
      adminPassword,
      memberEmail: DEV_MEMBER_EMAIL,
      memberPassword,
    };
  }

  private async seedSchedules(): Promise<string[]> {
    const created: string[] = [];
    for (const schedule of DEFAULT_SCHEDULES) {
      const existing = await this.prisma.jobSchedule.findUnique({ where: { key: schedule.key }, select: { id: true } });
      if (existing) continue;
      await this.prisma.jobSchedule.create({ data: schedule });
      created.push(schedule.key);
    }
    return created;
  }

  private async seedMockSource(): Promise<string[]> {
    if (this.config.isProduction) return [];
    const existing = await this.prisma.tenderSource.findUnique({ where: { slug: MOCK_SOURCE.slug }, select: { id: true } });
    if (existing) return [];
    await this.prisma.tenderSource.create({ data: MOCK_SOURCE });
    return [MOCK_SOURCE.slug];
  }

  /** Creates the staff roles and permissions (ADR-07) and grants each role its default permissions
   * additively — an admin's later changes to a role's grants are never overwritten by re-seeding. */
  private async seedRolesAndPermissions(): Promise<{ rolesCreated: string[]; permissionsCreated: string[] }> {
    const rolesCreated: string[] = [];
    const permissionsCreated: string[] = [];

    const permissionIds = new Map<string, string>();
    for (const key of PERMISSION_KEYS) {
      const existing = await this.prisma.permission.findUnique({ where: { key }, select: { id: true } });
      const permission = existing ?? (await this.prisma.permission.create({ data: { key } }));
      if (!existing) permissionsCreated.push(key);
      permissionIds.set(key, permission.id);
    }

    for (const key of STAFF_ROLE_KEYS) {
      const existingRole = await this.prisma.role.findUnique({ where: { key }, select: { id: true } });
      const role = existingRole ?? (await this.prisma.role.create({ data: { key, name: humanize(key) } }));
      if (!existingRole) rolesCreated.push(key);

      for (const permissionKey of DEFAULT_ROLE_PERMISSIONS[key]) {
        const permissionId = permissionIds.get(permissionKey);
        if (!permissionId) continue;
        await this.prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          update: {},
          create: { roleId: role.id, permissionId },
        });
      }
    }

    return { rolesCreated, permissionsCreated };
  }

  private async seedStates(): Promise<number> {
    let created = 0;
    for (const state of STATE_SEED_DATA) {
      const existing = await this.prisma.state.findUnique({ where: { code: state.code }, select: { code: true } });
      if (existing) continue;
      await this.prisma.state.create({ data: state });
      created++;
    }
    return created;
  }

  private async seedTenderTypes(): Promise<number> {
    let created = 0;
    for (const type of TENDER_TYPE_SEED_DATA) {
      const existing = await this.prisma.tenderType.findUnique({ where: { key: type.key }, select: { key: true } });
      if (existing) continue;
      await this.prisma.tenderType.create({ data: type });
      created++;
    }
    return created;
  }

  private async seedCategories(): Promise<number> {
    let created = 0;
    let sortOrder = 0;
    for (const category of CATEGORY_SEED_DATA) {
      sortOrder += 1;
      let parent = await this.prisma.category.findUnique({ where: { slug: category.slug } });
      if (!parent) {
        parent = await this.prisma.category.create({ data: { slug: category.slug, name: category.name, sortOrder } });
        created++;
      }
      let childOrder = 0;
      for (const child of category.children ?? []) {
        childOrder += 1;
        const existingChild = await this.prisma.category.findUnique({ where: { slug: child.slug } });
        if (existingChild) continue;
        await this.prisma.category.create({ data: { slug: child.slug, name: child.name, parentId: parent.id, sortOrder: childOrder } });
        created++;
      }
    }
    return created;
  }
}

function humanize(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
