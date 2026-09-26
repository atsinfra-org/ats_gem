import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { QueueProducer } from '../queues/queue.producer';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { NotificationDeliveryService, type NotificationPlan } from './notification-delivery.service';
import { formatIst, tenderMeta } from './notification-event-processor.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { TEMPLATE_VERSION, dedupKeys } from './notification-types';

const BATCH = 1000;
const HOUR_MS = 3_600_000;
/** Largest configurable reminder offset (hours); the sweep only looks this far ahead. */
const HORIZON_HOURS = 168;

interface DueRow {
  wid: string;
  uid: string;
  tid: string;
  title: string;
  reference_number: string | null;
  closing_at: Date;
}

/**
 * The offset a reminder should fire for: the smallest configured offset that is >= the time remaining. So a tender
 * that still has 3 days left triggers the "3 days" reminder once, not the "7 days" one it already passed, and a tender
 * saved with 5 hours left triggers only the smallest reminder that still applies. Returns null when nothing is due.
 */
export function dueOffsetHours(offsetsHours: number[], remainingMs: number): number | null {
  if (remainingMs <= 0) return null;
  const remainingHours = remainingMs / HOUR_MS;
  return [...offsetsHours].sort((a, b) => a - b).find((o) => remainingHours <= o) ?? null;
}

export function humanRemaining(remainingMs: number): string {
  const hours = Math.max(1, Math.round(remainingMs / HOUR_MS));
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * Deadline reminders (scheduled every 15 minutes) for tenders a user saved. Uses the tender's real closing time, skips
 * tenders that are deleted, duplicate, closed, cancelled or have no closing time, and is idempotent through the dedup key
 * (tender + exact closing instant + offset): a changed deadline legitimately produces a new reminder, a repeated sweep
 * produces nothing. Also re-enqueues emails whose queue message was lost (a delivery stuck in QUEUED).
 */
@Injectable()
@JobProcessor('notification.deadline-sweep')
export class DeadlineSweepHandler implements JobHandler<'notification.deadline-sweep'> {
  private readonly logger = new Logger(DeadlineSweepHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prefs: NotificationPreferencesService,
    private readonly delivery: NotificationDeliveryService,
    private readonly queue: QueueProducer,
  ) {}

  async handle(): Promise<JobResult> {
    const now = new Date();
    const summary = { scanned: 0, due: 0, created: 0, duplicates: 0, suppressed: 0, requeued: 0 };
    let cursor = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await this.prisma.$queryRaw<DueRow[]>`
        SELECT w.id::text AS wid, w.user_id::text AS uid, t.id::text AS tid, t.title, t.reference_number, t.closing_at
        FROM watchlist_items w
        JOIN tenders t ON t.id = w.tender_id
        JOIN users u ON u.id = w.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        WHERE w.id > ${cursor}::uuid
          AND t.deleted_at IS NULL AND t.duplicate_of_id IS NULL AND t.lifecycle = 'ACTIVE'
          AND t.status::text NOT IN ('CLOSED', 'CANCELLED', 'AWARDED', 'ARCHIVED')
          AND t.closing_at > ${now} AND t.closing_at <= ${new Date(now.getTime() + HORIZON_HOURS * HOUR_MS)}
        ORDER BY w.id LIMIT ${BATCH}`;
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].wid;
      summary.scanned += rows.length;

      const prefs = await this.prefs.resolveMany(rows.map((r) => r.uid));
      const due = rows.flatMap((r) => {
        const offset = dueOffsetHours(prefs.get(r.uid)?.deadlineOffsetsHours ?? [], r.closing_at.getTime() - now.getTime());
        return offset === null ? [] : [{ row: r, offset, key: dedupKeys.deadline(r.tid, r.closing_at, offset) }];
      });
      summary.due += due.length;
      if (due.length > 0) {
        const existing = new Set((await this.prisma.notification.findMany({ where: { userId: { in: due.map((d) => d.row.uid) }, dedupKey: { in: due.map((d) => d.key) } }, select: { userId: true, dedupKey: true } })).map((n) => `${n.userId}|${n.dedupKey}`));
        const users = new Map((await this.prisma.user.findMany({ where: { id: { in: due.map((d) => d.row.uid) } }, select: { id: true, email: true, isEmailVerified: true } })).map((u) => [u.id, u]));
        for (const d of due) {
          if (existing.has(`${d.row.uid}|${d.key}`)) {
            summary.duplicates++;
            continue;
          }
          const user = users.get(d.row.uid);
          const pref = prefs.get(d.row.uid);
          if (!user || !pref) continue;
          const remaining = d.row.closing_at.getTime() - now.getTime();
          const plan: NotificationPlan = {
            userId: d.row.uid,
            type: 'TENDER_DEADLINE',
            title: `Closing in ${humanRemaining(remaining)}: ${d.row.title}`.slice(0, 300),
            message: `Submission closes ${formatIst(d.row.closing_at)}.`,
            tenderId: d.row.tid,
            metadata: { ...tenderMeta({ id: d.row.tid, title: d.row.title, referenceNumber: d.row.reference_number, closingAt: d.row.closing_at, lifecycle: 'ACTIVE' }), offsetHours: d.offset },
            dedupKey: d.key,
            sourceEventId: `sweep:${now.toISOString().slice(0, 16)}`,
            expiresAt: d.row.closing_at,
          };
          const out = await this.delivery.deliver(plan, pref, { userId: user.id, email: user.email, emailable: user.isEmailVerified }, now);
          if (out.result === 'created') summary.created++;
          else if (out.result === 'duplicate') summary.duplicates++;
          else summary.suppressed++;
        }
      }
      if (rows.length < BATCH) break;
    }

    // Self-heal: a delivery still QUEUED after 10 minutes lost its queue message (Redis outage between commit and add).
    // Re-adding with the same deterministic job id is a no-op when the job still exists.
    const stuck = await this.prisma.notificationDelivery.findMany({ where: { status: 'QUEUED', queuedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true }, take: 500 });
    for (const s of stuck) {
      await this.queue.enqueue('notification.email', { deliveryId: s.id }, { jobId: `notif-email.${s.id}`, origin: 'scheduler' });
      summary.requeued++;
    }
    this.logger.log({ msg: 'deadline sweep completed', ...summary });
    return summary;
  }
}

/**
 * Daily digest (scheduled 08:00 IST): folds every alert waiting as DIGEST_PENDING - daily-frequency searches and
 * immediate alerts that exceeded the per-hour email caps - into ONE email per user. The claim is a conditional update,
 * so overlapping runs cannot double-send.
 */
@Injectable()
@JobProcessor('notification.send-digests')
export class DigestHandler implements JobHandler<'notification.send-digests'> {
  private readonly logger = new Logger(DigestHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
  ) {}

  async handle(): Promise<JobResult> {
    const users = await this.prisma.notificationDelivery.findMany({ where: { status: 'DIGEST_PENDING', digestId: null }, distinct: ['userId'], select: { userId: true }, take: 2000 });
    let digests = 0;
    let items = 0;
    for (const { userId } of users) {
      const pending = await this.prisma.notificationDelivery.findMany({ where: { userId, status: 'DIGEST_PENDING', digestId: null }, select: { id: true }, take: 2000 });
      if (pending.length === 0) continue;
      const digest = await this.prisma.$transaction(async (tx) => {
        const created = await tx.notificationDelivery.create({
          data: { userId, channel: 'EMAIL', status: 'QUEUED', templateKey: 'saved-search-digest', templateVersion: TEMPLATE_VERSION, itemCount: pending.length, queuedAt: new Date() },
          select: { id: true },
        });
        const claimed = await tx.notificationDelivery.updateMany({ where: { id: { in: pending.map((p) => p.id) }, status: 'DIGEST_PENDING', digestId: null }, data: { status: 'DIGESTED', digestId: created.id } });
        if (claimed.count === 0) throw new Error('nothing claimed');
        await tx.notificationDelivery.update({ where: { id: created.id }, data: { itemCount: claimed.count } });
        return { id: created.id, count: claimed.count };
      }).catch(() => null);
      if (!digest) continue;
      await this.queue.enqueue('notification.email', { deliveryId: digest.id }, { jobId: `notif-email.${digest.id}`, origin: 'scheduler' });
      digests++;
      items += digest.count;
    }
    this.logger.log({ msg: 'digest run completed', digests, items });
    return { digests, items };
  }
}
