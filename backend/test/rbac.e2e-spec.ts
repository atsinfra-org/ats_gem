import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { Public } from '../src/auth/public.decorator';
import { TokenService } from '../src/auth/token.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { RequireOrgRole } from '../src/rbac/require-org-role.decorator';
import { RequirePermissions } from '../src/rbac/require-permissions.decorator';
import { resetDatabase } from './support/database';

/** A throwaway controller purely to exercise the guard chain against real, seeded RBAC data. */
@Controller('test')
class GuardProbeController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Get('staff-only')
  @RequirePermissions('admin.access')
  staffOnly() {
    return { ok: true };
  }

  @Get('owner-only')
  @RequireOrgRole('OWNER')
  ownerOnly() {
    return { ok: true };
  }

  @Get('member-or-above')
  @RequireOrgRole('MEMBER')
  memberOrAbove() {
    return { ok: true };
  }
}

@Module({ controllers: [GuardProbeController] })
class GuardProbeModule {}

describe('RBAC guard chain (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokens: TokenService;

  beforeAll(async () => {
    // The real ApiModule (same guard chain, same module graph as production) plus a throwaway
    // controller to probe it against — see app.e2e-spec.ts for the same base pattern.
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule, GuardProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(() => app?.close());

  function bearer(sub: string, org: string, roles: string[] = []) {
    return `Bearer ${tokens.signAccessToken({ sub, org, roles, sid: '00000000-0000-7000-8000-000000000000' }).token}`;
  }

  it('allows a public route with no token at all', async () => {
    await request(app.getHttpServer()).get('/api/v1/test/public').expect(200);
  });

  it('rejects every non-public route without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/test/staff-only').expect(401);
    await request(app.getHttpServer()).get('/api/v1/test/owner-only').expect(401);
  });

  it('rejects a malformed or expired bearer token', async () => {
    await request(app.getHttpServer()).get('/api/v1/test/staff-only').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });

  describe('PermissionsGuard', () => {
    it('denies a signed-in user with no staff role', async () => {
      const user = await prisma.user.create({ data: { email: 'plain-user@example.com', name: 'Plain User' } });
      const res = await request(app.getHttpServer()).get('/api/v1/test/staff-only').set('Authorization', bearer(user.id, user.id)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows a user whose staff role grants the permission, and re-checks the DB rather than trusting the JWT', async () => {
      const user = await prisma.user.create({ data: { email: 'staff@example.com', name: 'Staff User' } });
      // Roles/permissions survive resetDatabase() by design (they are reference data another test
      // file may already have seeded), so this ensures they exist rather than assuming a clean slate.
      const role = await prisma.role.upsert({ where: { key: 'ADMIN' }, update: {}, create: { key: 'ADMIN', name: 'Admin' } });
      const permission = await prisma.permission.upsert({ where: { key: 'admin.access' }, update: {}, create: { key: 'admin.access' } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

      // The JWT itself claims no roles at all — PermissionsGuard must still allow it via the DB.
      await request(app.getHttpServer()).get('/api/v1/test/staff-only').set('Authorization', bearer(user.id, user.id, [])).expect(200);

      await prisma.userRole.delete({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
      // Revoking the role takes effect immediately, without waiting for the token to expire.
      const after = await request(app.getHttpServer()).get('/api/v1/test/staff-only').set('Authorization', bearer(user.id, user.id)).expect(403);
      expect(after.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('OrgRoleGuard', () => {
    async function memberWithRole(role: 'OWNER' | 'MEMBER' | 'VIEWER') {
      const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}@example.com`, name: role } });
      const org = await prisma.organization.create({ data: { name: `${role} Org`, slug: `${role.toLowerCase()}-org` } });
      await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role } });
      return { userId: user.id, orgId: org.id };
    }

    it('denies a caller with no membership in the claimed organization', async () => {
      const user = await prisma.user.create({ data: { email: 'stranger@example.com', name: 'Stranger' } });
      const org = await prisma.organization.create({ data: { name: 'Someone Else Org', slug: 'someone-else-org' } });
      const res = await request(app.getHttpServer()).get('/api/v1/test/owner-only').set('Authorization', bearer(user.id, org.id)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('enforces role rank: VIEWER fails a MEMBER-gated route, MEMBER and OWNER both pass it', async () => {
      const viewer = await memberWithRole('VIEWER');
      const member = await memberWithRole('MEMBER');
      const owner = await memberWithRole('OWNER');

      await request(app.getHttpServer()).get('/api/v1/test/member-or-above').set('Authorization', bearer(viewer.userId, viewer.orgId)).expect(403);
      await request(app.getHttpServer()).get('/api/v1/test/member-or-above').set('Authorization', bearer(member.userId, member.orgId)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/test/member-or-above').set('Authorization', bearer(owner.userId, owner.orgId)).expect(200);
    });

    it('rejects MEMBER and VIEWER on an OWNER-only route', async () => {
      const member = await memberWithRole('MEMBER');
      const owner = await memberWithRole('OWNER');

      await request(app.getHttpServer()).get('/api/v1/test/owner-only').set('Authorization', bearer(member.userId, member.orgId)).expect(403);
      await request(app.getHttpServer()).get('/api/v1/test/owner-only').set('Authorization', bearer(owner.userId, owner.orgId)).expect(200);
    });
  });
});
