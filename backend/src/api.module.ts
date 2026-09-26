import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggingModule } from './logging/logging.module';
import { MarketModule } from './market/market.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OutboxModule } from './outbox/outbox.module';
import { QueuesModule } from './queues/queues.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RbacModule } from './rbac/rbac.module';
import { OrgRoleGuard } from './rbac/org-role.guard';
import { PermissionsGuard } from './rbac/permissions.guard';
import { RedisModule } from './redis/redis.module';
import { SavedSearchesModule } from './saved-searches/saved-searches.module';
import { SearchModule } from './search/search.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { TendersModule } from './tenders/tenders.module';
import { ProcuringEntitiesModule } from './tenders/entities/procuring-entities.module';
import { DuplicateCandidatesModule } from './tenders/dedup/duplicate-candidates.module';
import { DocumentsModule } from './tenders/documents/documents.module';
import { RequirementsModule } from './tenders/requirements/requirements.module';
import { TimelineModule } from './tenders/timeline/timeline.module';
import { CorrigendaModule } from './tenders/corrigenda/corrigenda.module';
import { TenderCorrectionsModule } from './tenders/admin/tender-corrections.module';
import { UsersModule } from './users/users.module';
import { WatchlistModule } from './watchlist/watchlist.module';

/**
 * Composition root for the HTTP API process. The API produces jobs and outbox events but never
 * consumes queues — consumers live in the worker process. Feature modules are added phase by phase.
 *
 * The global guards run in this declared order: `RateLimitGuard` rejects throttled requests before
 * any other work, then `JwtAuthGuard` populates `req.user` (or lets
 * a `@Public()` route through, opportunistically for a signed-in caller), then `PermissionsGuard`
 * checks `@RequirePermissions`, then `OrgRoleGuard` checks `@RequireOrgRole`. Each of the latter two
 * is a no-op unless its decorator is present, so the ordering only matters for routes using both.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    QueuesModule,
    OutboxModule,
    AuditModule,
    AuthModule,
    RbacModule,
    HealthModule,
    UsersModule,
    OrganizationsModule,
    TaxonomyModule,
    MarketModule,
    SearchModule,
    TendersModule,
    ProcuringEntitiesModule,
    DuplicateCandidatesModule,
    DocumentsModule,
    RequirementsModule,
    TimelineModule,
    CorrigendaModule,
    TenderCorrectionsModule,
    SavedSearchesModule,
    WatchlistModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: OrgRoleGuard },
  ],
})
export class ApiModule {}
