import { Test } from '@nestjs/testing';
import { PasswordService } from '../src/auth/password.service';
import { AppConfig } from '../src/config/app-config.service';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { SeedService } from '../src/database/seed.service';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';

async function seedServiceFor(nodeEnv: 'development' | 'test' | 'production') {
  const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, DatabaseModule], providers: [SeedService] })
    .overrideProvider(AppConfig)
    .useFactory(withConfig({ NODE_ENV: nodeEnv }))
    .compile();
  await moduleRef.init();
  return { moduleRef, seed: moduleRef.get(SeedService), prisma: moduleRef.get(PrismaService) };
}

describe('SeedService (e2e, PostgreSQL)', () => {
  it('seeds reference data idempotently and never creates demo data outside development', async () => {
    const { moduleRef, seed, prisma } = await seedServiceFor('test');
    try {
      await resetDatabase(prisma);
      const first = await seed.run();
      expect(first.devData).toBeNull();
      expect(await prisma.state.count()).toBe(36);
      expect(await prisma.tenderType.count()).toBe(6);
      expect(await prisma.role.count({ where: { key: { in: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'CRAWLER_MANAGER', 'SUPPORT'] } } })).toBe(5);
      expect(await prisma.user.count()).toBe(0);

      const second = await seed.run();
      expect(second).toMatchObject({ statesCreated: 0, tenderTypesCreated: 0, categoriesCreated: 0, rolesCreated: [], permissionsCreated: [], devData: null });
    } finally {
      await moduleRef.close();
    }
  });

  it('SUPER_ADMIN holds every permission, other roles a subset', async () => {
    const { moduleRef, seed, prisma } = await seedServiceFor('test');
    try {
      await seed.run();
      const grants = async (key: string) => (await prisma.rolePermission.count({ where: { role: { key } } }));
      const total = await prisma.permission.count();
      expect(await grants('SUPER_ADMIN')).toBe(total);
      expect(await grants('SUPPORT')).toBeLessThan(total);
    } finally {
      await moduleRef.close();
    }
  });

  it('never seeds anything demo-like in production, including the mock source', async () => {
    const { moduleRef, seed, prisma } = await seedServiceFor('production');
    try {
      await resetDatabase(prisma);
      const result = await seed.run();
      expect(result.devData).toBeNull();
      expect(result.sourcesCreated).toEqual([]);
      expect(await prisma.user.count()).toBe(0);
    } finally {
      await moduleRef.close();
    }
  });

  it('in development creates the demo admin/member, organization, tender, saved search and bookmark — once', async () => {
    const { moduleRef, seed, prisma } = await seedServiceFor('development');
    try {
      await resetDatabase(prisma);
      const first = await seed.run();
      expect(first.devData).toMatchObject({ adminEmail: 'admin@dev.atsgem.local', memberEmail: 'member@dev.atsgem.local' });
      const { adminPassword, memberPassword } = first.devData!;
      expect(adminPassword).not.toBe(memberPassword);
      expect(adminPassword.length).toBeGreaterThanOrEqual(16);

      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@dev.atsgem.local' }, include: { userRoles: { include: { role: true } } } });
      expect(admin.userRoles.map((r) => r.role.key)).toEqual(['SUPER_ADMIN']);
      // Stored only as an Argon2id hash, and it verifies against the password that was returned.
      expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
      await expect(new PasswordService().verify(admin.passwordHash!, adminPassword)).resolves.toBe(true);

      const member = await prisma.user.findUniqueOrThrow({ where: { email: 'member@dev.atsgem.local' } });
      const memberships = await prisma.organizationMember.findMany({ where: { userId: member.id }, orderBy: { role: 'asc' } });
      expect(memberships.map((m) => m.role).sort()).toEqual(['MEMBER', 'OWNER']);
      await expect(new PasswordService().verify(member.passwordHash!, memberPassword)).resolves.toBe(true);

      const tender = await prisma.tender.findFirstOrThrow({ where: { title: { startsWith: '[DEV SEED]' } } });
      expect(tender.categoryId).not.toBeNull();
      expect(await prisma.savedSearch.count({ where: { name: { startsWith: '[DEV SEED]' } } })).toBe(1);
      expect(await prisma.watchlistItem.count({ where: { userId: admin.id, tenderId: tender.id } })).toBe(1);

      // Re-seeding neither duplicates the data nor resets (or re-reveals) a password.
      const second = await seed.run();
      expect(second.devData).toBeNull();
      expect(await prisma.user.count()).toBe(2);
      await expect(new PasswordService().verify((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash!, adminPassword)).resolves.toBe(true);
    } finally {
      await moduleRef.close();
    }
  });
});
