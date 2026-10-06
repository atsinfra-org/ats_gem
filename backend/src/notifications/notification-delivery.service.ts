import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { QueueProducer } from '../queues/queue.producer';
import type { ResolvedPreferences } from './notification-preferences.service';
import { NotificationMetadataSchema, NOTIFICATION_TYPES, TEMPLATE_VERSION, type NotificationMetadata, type NotificationType } from './notification-types';
import { quietHoursDelayMs } from './quiet-hours';

export interface NotificationPlan {
  userId: string;
  organizationId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  tenderId?: string;
  metadata: NotificationMetadata;
  dedupKey: string;
  sourceEventId?: string;
  expiresAt?: Date | null;
  /** Saved-search alerts only: how this user asked to be alerted for the matching search. */
  alertFrequency?: 'IMMEDIATE' | 'DAILY';
}

export interface Recipient {
  userId: string;
  email: string;
  emailable: boolean;
}

export type DeliveryOutcome =
  | { result: 'suppressed'; reason: 'PREFERENCE_DISABLED' | 'IN_APP_RATE_CAPPED' }
  | { result: 'duplicate' }
  | { result: 'created'; notificationId: string; email: 'queued' | 'digest-pending' | 'skipped' | 'not-applicable'; skipReason?: string };

export interface DeliveryItem {
  plan: NotificationPlan;
  prefs: ResolvedPreferences;
  recipient: Recipient;
}

const HOUR_MS = 3_600_000;
const ACTIVE_EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'RETRYING'] as const;
const ENQUEUE_PARALLELISM = 50;

/**
 * The single place notifications become real. Order (docs/ARCHITECTURE.md Sec 21.2), evaluated for a whole batch at a
 * time so a large match set costs a handful of queries rather than several per recipient:
 *   preference check -> existing-dedup check -> in-app spam cap -> deduplicated in-app records ->
 *   email decision (preference, verified address, digest, rate caps, quiet hours) -> delivery rows -> email queue.
 * Idempotent: replaying the same plans changes nothing (the unique (user, dedupKey) is the final arbiter under races).
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly config: AppConfig,
  ) {}

  async deliver(plan: NotificationPlan, prefs: ResolvedPreferences, recipient: Recipient, now: Date = new Date()): Promise<DeliveryOutcome> {
    return (await this.deliverMany([{ plan, prefs, recipient }], now))[0];
  }

  async deliverMany(items: DeliveryItem[], now: Date = new Date()): Promise<DeliveryOutcome[]> {
    const outcomes: (DeliveryOutcome | undefined)[] = new Array<DeliveryOutcome | undefined>(items.length).fill(undefined);
    if (items.length === 0) return [];
    const since = new Date(now.getTime() - HOUR_MS);

    // 1. preferences
    const wanted = items.map((it) => {
      const def = NOTIFICATION_TYPES[it.plan.type];
      const critical = def.priority === 'CRITICAL';
      return { def, critical, inApp: critical || it.prefs.inApp[def.category], email: def.emailed && (critical || it.prefs.email[def.category]) };
    });
    let live = items.map((_, i) => i).filter((i) => {
      if (!wanted[i].inApp && !wanted[i].email) {
        outcomes[i] = { result: 'suppressed', reason: 'PREFERENCE_DISABLED' };
        return false;
      }
      return true;
    });

    // 2. already delivered (replays, re-ingestion): one query for the whole batch
    if (live.length > 0) {
      const userIds = [...new Set(live.map((i) => items[i].plan.userId))];
      const keys = [...new Set(live.map((i) => items[i].plan.dedupKey))];
      const existing = new Set((await this.prisma.notification.findMany({ where: { userId: { in: userIds }, dedupKey: { in: keys } }, select: { userId: true, dedupKey: true } })).map((n) => `${n.userId}|${n.dedupKey}`));
      live = live.filter((i) => {
        if (existing.has(`${items[i].plan.userId}|${items[i].plan.dedupKey}`)) {
          outcomes[i] = { result: 'duplicate' };
          return false;
        }
        return true;
      });
    }

    // 3. in-app cap per saved search per hour
    const searchUsers = [...new Set(live.filter((i) => items[i].plan.type === 'SAVED_SEARCH_MATCH').map((i) => items[i].plan.userId))];
    const inAppCounts = new Map<string, number>();
    if (searchUsers.length > 0) {
      const rows = await this.prisma.$queryRaw<{ user_id: string; sid: string; n: number }[]>`
        SELECT user_id::text, metadata->>'savedSearchId' AS sid, count(*)::int AS n FROM notifications
        WHERE user_id = ANY(${searchUsers}::uuid[]) AND type = 'SAVED_SEARCH_MATCH' AND created_at > ${since} AND metadata ? 'savedSearchId'
        GROUP BY 1, 2`;
      for (const r of rows) inAppCounts.set(`${r.user_id}|${r.sid}`, r.n);
    }
    const inAppCap = this.config.get('NOTIFY_INAPP_MAX_PER_SEARCH_PER_HOUR');
    live = live.filter((i) => {
      const { plan } = items[i];
      const sid = plan.metadata.savedSearchId;
      if (plan.type !== 'SAVED_SEARCH_MATCH' || !sid) return true;
      const key = `${plan.userId}|${sid}`;
      const n = inAppCounts.get(key) ?? 0;
      if (n >= inAppCap) {
        this.logger.warn({ msg: 'notification suppressed: in-app rate cap', type: plan.type, userId: plan.userId, savedSearchId: sid, cap: inAppCap });
        outcomes[i] = { result: 'suppressed', reason: 'IN_APP_RATE_CAPPED' };
        return false;
      }
      inAppCounts.set(key, n + 1);
      return true;
    });

    // 4. in-app records (a record always exists when any channel is wanted; in-app off => stored as already read)
    const rows = live.map((i) => {
      const { plan } = items[i];
      const def = wanted[i].def;
      return {
        i,
        data: {
          id: randomUUID(),
          userId: plan.userId,
          organizationId: plan.organizationId ?? null,
          type: plan.type,
          title: plan.title.slice(0, 300),
          message: plan.message.slice(0, 1000),
          entityType: plan.tenderId ? 'tender' : null,
          entityId: plan.tenderId ?? null,
          priority: def.priority,
          metadata: NotificationMetadataSchema.parse(plan.metadata),
          dedupKey: plan.dedupKey,
          sourceEventId: plan.sourceEventId ?? null,
          templateKey: def.template,
          templateVersion: TEMPLATE_VERSION,
          expiresAt: plan.expiresAt ?? null,
          isRead: !wanted[i].inApp,
          readAt: wanted[i].inApp ? null : now,
        },
      };
    });
    const createdRows = rows.length ? await this.prisma.notification.createManyAndReturn({ data: rows.map((r) => r.data), skipDuplicates: true, select: { id: true } }) : [];
    const createdIds = new Set(createdRows.map((r) => r.id));
    const created: { i: number; id: string }[] = [];
    for (const r of rows) {
      if (createdIds.has(r.data.id)) created.push({ i: r.i, id: r.data.id });
      else outcomes[r.i] = { result: 'duplicate' }; // lost a race with a concurrent identical plan
    }
    for (const c of created) this.logger.log({ msg: 'notification generated', notificationId: c.id, type: items[c.i].plan.type, sourceEventId: items[c.i].plan.sourceEventId });

    // 5. email decisions
    const emailUsers = [...new Set(created.filter((c) => NOTIFICATION_TYPES[items[c.i].plan.type].emailed && wanted[c.i].email).map((c) => items[c.i].plan.userId))];
    const perUser = new Map<string, number>();
    const perSearch = new Map<string, number>();
    if (emailUsers.length > 0) {
      const counts = await this.prisma.$queryRaw<{ user_id: string; sid: string | null; n: number }[]>`
        SELECT d.user_id::text, n.metadata->>'savedSearchId' AS sid, count(*)::int AS n
        FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
        WHERE d.user_id = ANY(${emailUsers}::uuid[]) AND d.status::text = ANY(${[...ACTIVE_EMAIL_STATUSES]}::text[]) AND d.created_at > ${since}
        GROUP BY 1, 2`;
      for (const r of counts) {
        perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + r.n);
        if (r.sid) perSearch.set(`${r.user_id}|${r.sid}`, r.n);
      }
    }
    const capSearch = this.config.get('NOTIFY_EMAIL_MAX_PER_SEARCH_PER_HOUR');
    const capUser = this.config.get('NOTIFY_EMAIL_MAX_PER_USER_PER_HOUR');

    const deliveryRows: Prisma.NotificationDeliveryCreateManyInput[] = [];
    const jobs: { deliveryId: string; delay: number }[] = [];
    for (const { i, id } of created) {
      const { plan, prefs, recipient } = items[i];
      const { def, critical } = wanted[i];
      if (!def.emailed) {
        outcomes[i] = { result: 'created', notificationId: id, email: 'not-applicable' };
        continue;
      }
      const base = { userId: plan.userId, notificationId: id, channel: 'EMAIL' as const, templateKey: def.template, templateVersion: TEMPLATE_VERSION };
      const skip = (reason: string) => {
        deliveryRows.push({ ...base, status: 'SKIPPED', skipReason: reason });
        outcomes[i] = { result: 'created', notificationId: id, email: 'skipped', skipReason: reason };
      };
      const digest = () => {
        deliveryRows.push({ ...base, templateKey: 'saved-search-digest', status: 'DIGEST_PENDING' });
        outcomes[i] = { result: 'created', notificationId: id, email: 'digest-pending' };
      };
      if (!wanted[i].email) {
        skip('PREFERENCE_DISABLED');
        continue;
      }
      if (!recipient.emailable) {
        skip('RECIPIENT_UNAVAILABLE');
        continue;
      }
      if (plan.type === 'SAVED_SEARCH_MATCH' && plan.alertFrequency === 'DAILY') {
        digest();
        continue;
      }
      if (!critical) {
        const sid = plan.metadata.savedSearchId;
        const userN = perUser.get(plan.userId) ?? 0;
        const searchN = sid ? (perSearch.get(`${plan.userId}|${sid}`) ?? 0) : 0;
        if ((sid && searchN >= capSearch) || userN >= capUser) {
          this.logger.warn({ msg: 'email capped', type: plan.type, userId: plan.userId, overSearch: !!sid && searchN >= capSearch, overUser: userN >= capUser });
          if (plan.type === 'SAVED_SEARCH_MATCH') digest();
          else skip('EMAIL_RATE_CAPPED');
          continue;
        }
        perUser.set(plan.userId, userN + 1);
        if (sid) perSearch.set(`${plan.userId}|${sid}`, searchN + 1);
      }
      const deliveryId = randomUUID();
      deliveryRows.push({ ...base, id: deliveryId, status: 'QUEUED', queuedAt: now });
      jobs.push({ deliveryId, delay: critical ? 0 : quietHoursDelayMs(now, prefs.quiet) });
      outcomes[i] = { result: 'created', notificationId: id, email: 'queued' };
    }
    if (deliveryRows.length > 0) await this.prisma.notificationDelivery.createMany({ data: deliveryRows });

    // 6. email queue (deterministic job ids: re-adding is a no-op)
    for (let k = 0; k < jobs.length; k += ENQUEUE_PARALLELISM) {
      await Promise.all(jobs.slice(k, k + ENQUEUE_PARALLELISM).map((j) => this.queue.enqueue('notification.email', { deliveryId: j.deliveryId }, { jobId: `notif-email.${j.deliveryId}`, delay: j.delay || undefined, origin: 'worker' })));
    }
    if (jobs.length > 0) this.logger.log({ msg: 'emails queued', count: jobs.length });

    return outcomes.map((o) => o ?? { result: 'duplicate' as const });
  }
}
