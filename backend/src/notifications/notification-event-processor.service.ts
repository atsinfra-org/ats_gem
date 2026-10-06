import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DOMAIN_EVENT_SCHEMAS, isDomainEventType, type DomainEventPayload, type DomainEventType } from '../outbox/domain-events';
import { PermanentJobError } from '../queues/job-errors';
import { NotificationDeliveryService, type DeliveryOutcome, type NotificationPlan, type Recipient } from './notification-delivery.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FIELD_LABELS, NOTIFY_WORTHY_TENDER_FIELDS, dedupKeys, type NotificationMetadata } from './notification-types';
import { SavedSearchMatcherService, type SavedSearchMatch } from './saved-search-matcher.service';

export interface EventSummary {
  [key: string]: string | number | boolean | null;
  recipients: number;
  created: number;
  duplicates: number;
  suppressed: number;
  emailQueued: number;
  digestPending: number;
  skipped: number;
}

interface TenderSnapshot {
  id: string;
  title: string;
  referenceNumber: string | null;
  closingAt: Date | null;
  lifecycle: string;
}

const DELIVERY_BATCH = 500;

const emptySummary = (): EventSummary => ({ recipients: 0, created: 0, duplicates: 0, suppressed: 0, emailQueued: 0, digestPending: 0, skipped: 0 });

export const formatIst = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date)} IST`;
};

/**
 * Turns one outbox domain event into deduplicated notifications for exactly the users who should hear about it.
 * Recipients come from real data only: users who saved the tender (watchlist) and users whose alert-enabled saved
 * search matches it (Phase 7 semantics, see SavedSearchMatcherService). Safe to run any number of times for the same
 * event: every plan carries a deterministic dedup key.
 */
@Injectable()
export class NotificationEventProcessor {
  private readonly logger = new Logger(NotificationEventProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: SavedSearchMatcherService,
    private readonly prefs: NotificationPreferencesService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async process(eventId: string): Promise<EventSummary> {
    const row = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!row) throw new PermanentJobError(`outbox event ${eventId} not found`);
    if (!isDomainEventType(row.eventType)) throw new PermanentJobError(`unsupported event type ${row.eventType}`);
    const parsed = DOMAIN_EVENT_SCHEMAS[row.eventType].safeParse(row.payload);
    if (!parsed.success) throw new PermanentJobError(`malformed payload for ${row.eventType}`);

    const type: DomainEventType = row.eventType;
    switch (type) {
      case 'tender.created':
        return this.onTenderCreated(eventId, parsed.data as DomainEventPayload<'tender.created'>);
      case 'tender.updated':
        return this.onTenderUpdated(eventId, parsed.data as DomainEventPayload<'tender.updated'>, row.createdAt);
      case 'tender.closed':
        return this.onTenderClosed(eventId, parsed.data as DomainEventPayload<'tender.closed'>);
      case 'tender.corrigendum_created':
        return this.onCorrigendum(eventId, parsed.data as DomainEventPayload<'tender.corrigendum_created'>);
      case 'user.security_event':
        return this.onSecurityEvent(eventId, parsed.data as DomainEventPayload<'user.security_event'>);
      default:
        return emptySummary();
    }
  }

  // ── event handlers ────────────────────────────────────────────────────────────────────────────

  private async onTenderCreated(eventId: string, p: DomainEventPayload<'tender.created'>): Promise<EventSummary> {
    const tender = await this.loadTender(p.tenderId);
    if (!tender) return { ...emptySummary(), skippedReason: 'TENDER_UNAVAILABLE' };
    const matches = await this.matcher.match(tender.id);
    const byUser = groupByUser(matches);
    const plans: NotificationPlan[] = [...byUser.entries()].map(([userId, list]) => {
      const first = list[0];
      const immediate = list.some((m) => m.alertFrequency === 'IMMEDIATE');
      return {
        userId,
        organizationId: first.organizationId,
        type: 'SAVED_SEARCH_MATCH',
        title: `New tender matches "${first.name}"`,
        message: tenderLine(tender),
        tenderId: tender.id,
        metadata: { ...tenderMeta(tender), savedSearchId: first.savedSearchId, savedSearchNames: list.slice(0, 3).map((m) => m.name) },
        dedupKey: dedupKeys.savedSearchMatch(tender.id),
        sourceEventId: eventId,
        alertFrequency: immediate ? 'IMMEDIATE' : 'DAILY',
      };
    });
    return this.run(plans);
  }

  private async onTenderUpdated(eventId: string, p: DomainEventPayload<'tender.updated'>, eventAt: Date): Promise<EventSummary> {
    const worthy = p.changedFields.filter((f) => (NOTIFY_WORTHY_TENDER_FIELDS as readonly string[]).includes(f));
    if (worthy.length === 0) return { ...emptySummary(), skippedReason: 'NOT_NOTIFY_WORTHY' };
    const tender = await this.loadTender(p.tenderId);
    if (!tender) return { ...emptySummary(), skippedReason: 'TENDER_UNAVAILABLE' };

    const cancelled = worthy.includes('lifecycle') && tender.lifecycle === 'CANCELLED';
    const diff = worthy.includes('closingAt') ? await this.closingChange(tender.id, eventAt) : null;
    const labels = worthy.filter((f) => f !== 'lifecycle' || !cancelled).map((f) => FIELD_LABELS[f] ?? f);
    let message = cancelled ? 'The procuring entity has cancelled this tender.' : `Changed: ${labels.join(', ')}.`;
    if (!cancelled && diff?.to) message = `The closing date is now ${formatIst(diff.to)}${diff.from ? ` (was ${formatIst(diff.from)})` : ''}.${labels.length > 1 ? ` Also changed: ${labels.filter((l) => l !== 'closing date').join(', ')}.` : ''}`;

    const watchers = await this.watchers(tender.id);
    const plans: NotificationPlan[] = watchers.map((userId) => ({
      userId,
      type: cancelled ? 'TENDER_CANCELLED' : 'TENDER_UPDATED',
      title: `${cancelled ? 'Tender cancelled' : 'Tender updated'}: ${tender.title}`.slice(0, 300),
      message,
      tenderId: tender.id,
      metadata: { ...tenderMeta(tender), changedFields: worthy, ...(diff?.from ? { previousClosingAt: diff.from } : {}) },
      dedupKey: dedupKeys.tenderEvent(cancelled ? 'TENDER_CANCELLED' : 'TENDER_UPDATED', eventId),
      sourceEventId: eventId,
    }));
    return this.run(plans);
  }

  private async onTenderClosed(eventId: string, p: DomainEventPayload<'tender.closed'>): Promise<EventSummary> {
    const tender = await this.loadTender(p.tenderId);
    if (!tender) return { ...emptySummary(), skippedReason: 'TENDER_UNAVAILABLE' };
    const plans: NotificationPlan[] = (await this.watchers(tender.id)).map((userId) => ({
      userId,
      type: 'TENDER_STATUS_CHANGED',
      title: `Tender closed: ${tender.title}`.slice(0, 300),
      message: 'This tender is now closed for submissions.',
      tenderId: tender.id,
      metadata: tenderMeta(tender),
      dedupKey: dedupKeys.tenderEvent('TENDER_STATUS_CHANGED', eventId),
      sourceEventId: eventId,
    }));
    return this.run(plans);
  }

  private async onCorrigendum(eventId: string, p: DomainEventPayload<'tender.corrigendum_created'>): Promise<EventSummary> {
    const tender = await this.loadTender(p.tenderId);
    if (!tender) return { ...emptySummary(), skippedReason: 'TENDER_UNAVAILABLE' };
    const corrigendum = await this.prisma.tenderCorrigendum.findUnique({ where: { id: p.corrigendumId }, select: { title: true, publishedAt: true } });
    if (!corrigendum) throw new PermanentJobError(`corrigendum ${p.corrigendumId} not found`);

    // Eligible: users who saved the tender, plus users whose alert-enabled saved search matches it.
    const users = new Set(await this.watchers(tender.id));
    const matches = await this.matcher.match(tender.id);
    const orgByUser = new Map<string, string>();
    for (const m of matches) {
      users.add(m.userId);
      orgByUser.set(m.userId, m.organizationId);
    }
    const plans: NotificationPlan[] = [...users].map((userId) => ({
      userId,
      organizationId: orgByUser.get(userId) ?? null,
      type: 'TENDER_CORRIGENDUM',
      title: `Corrigendum issued: ${tender.title}`.slice(0, 300),
      message: corrigendum.title,
      tenderId: tender.id,
      metadata: { ...tenderMeta(tender), corrigendumId: p.corrigendumId, corrigendumTitle: corrigendum.title.slice(0, 300) },
      dedupKey: dedupKeys.corrigendum(p.corrigendumId),
      sourceEventId: eventId,
    }));
    return this.run(plans);
  }

  private async onSecurityEvent(eventId: string, p: DomainEventPayload<'user.security_event'>): Promise<EventSummary> {
    const copy = {
      PASSWORD_CHANGED: { title: 'Your password was changed', message: 'The password for your ATS GeM account was just changed and your other sessions were signed out.' },
      PASSWORD_RESET: { title: 'Your password was reset', message: 'Your ATS GeM password was reset with an emailed link and all sessions were signed out.' },
      EMAIL_VERIFIED: { title: 'Email address verified', message: 'Your email address is now verified.' },
    }[p.kind];
    const isAccount = p.kind === 'EMAIL_VERIFIED';
    const plan: NotificationPlan = {
      userId: p.userId,
      type: isAccount ? 'ACCOUNT' : 'SECURITY',
      title: copy.title,
      message: copy.message,
      metadata: { securityKind: p.kind },
      dedupKey: isAccount ? dedupKeys.account(eventId) : dedupKeys.security(eventId),
      sourceEventId: eventId,
    };
    return this.run([plan]);
  }

  // ── shared plumbing ───────────────────────────────────────────────────────────────────────────

  private async loadTender(id: string): Promise<TenderSnapshot | null> {
    return this.prisma.tender.findFirst({ where: { id, deletedAt: null, duplicateOfId: null }, select: { id: true, title: true, referenceNumber: true, closingAt: true, lifecycle: true } });
  }

  private async watchers(tenderId: string): Promise<string[]> {
    const rows = await this.prisma.watchlistItem.findMany({ where: { tenderId, user: { status: 'ACTIVE', deletedAt: null } }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private async closingChange(tenderId: string, eventAt: Date): Promise<{ from: string | null; to: string | null } | null> {
    const rows = await this.prisma.$queryRaw<{ diff: { closingAt?: { from: string | null; to: string | null } } }[]>`
      SELECT diff FROM tender_versions WHERE tender_id = ${tenderId}::uuid AND diff ? 'closingAt'
      ORDER BY abs(extract(epoch FROM (detected_at - ${eventAt}))) LIMIT 1`;
    const change = rows[0]?.diff.closingAt;
    return change ? { from: change.from ?? null, to: change.to ?? null } : null;
  }

  private async run(plans: NotificationPlan[]): Promise<EventSummary> {
    const summary = emptySummary();
    summary.recipients = plans.length;
    if (plans.length === 0) return summary;
    const userIds = plans.map((p) => p.userId);
    const [prefs, users] = await Promise.all([
      this.prefs.resolveMany(userIds),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, isEmailVerified: true, status: true, deletedAt: true } }),
    ]);
    const recipients = new Map<string, Recipient>(users.map((u) => [u.id, { userId: u.id, email: u.email, emailable: u.isEmailVerified && u.status === 'ACTIVE' && u.deletedAt === null }]));
    const items = plans.flatMap((plan) => {
      const recipient = recipients.get(plan.userId);
      const pref = prefs.get(plan.userId);
      if (!recipient || !pref) {
        summary.skipped++;
        return [];
      }
      return [{ plan, prefs: pref, recipient }];
    });
    // Batches keep memory bounded for very large match sets while still costing only a few queries each.
    for (let i = 0; i < items.length; i += DELIVERY_BATCH) {
      for (const outcome of await this.delivery.deliverMany(items.slice(i, i + DELIVERY_BATCH))) tally(summary, outcome);
    }
    return summary;
  }
}

function tally(s: EventSummary, o: DeliveryOutcome): void {
  if (o.result === 'duplicate') s.duplicates++;
  else if (o.result === 'suppressed') s.suppressed++;
  else {
    s.created++;
    if (o.email === 'queued') s.emailQueued++;
    else if (o.email === 'digest-pending') s.digestPending++;
    else if (o.email === 'skipped') s.skipped++;
  }
}

function groupByUser(matches: SavedSearchMatch[]): Map<string, SavedSearchMatch[]> {
  const out = new Map<string, SavedSearchMatch[]>();
  for (const m of [...matches].sort((a, b) => a.name.localeCompare(b.name) || a.savedSearchId.localeCompare(b.savedSearchId))) {
    const list = out.get(m.userId);
    if (list) list.push(m);
    else out.set(m.userId, [m]);
  }
  return out;
}

const tenderLine = (t: TenderSnapshot): string => `${t.title}${t.referenceNumber ? ` (${t.referenceNumber})` : ''}`.slice(0, 500);

export function tenderMeta(t: TenderSnapshot): NotificationMetadata {
  return {
    tenderId: t.id,
    tenderTitle: t.title.slice(0, 300),
    ...(t.referenceNumber ? { referenceNumber: t.referenceNumber.slice(0, 120) } : {}),
    ...(t.closingAt ? { closingAt: t.closingAt.toISOString() } : {}),
  };
}
