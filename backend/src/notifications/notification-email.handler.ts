import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { EmailTransport, PermanentEmailError } from '../email/email-transport';
import { PermanentJobError } from '../queues/job-errors';
import type { JobPayload } from '../queues/job.registry';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../workers/job-handler';
import { renderEmail, type RenderContext, type RenderedEmail } from './email-templates';
import { NotificationMetadataSchema, type TemplateKey } from './notification-types';

/** Strips anything that looks like an address or token from an error before it is stored or logged. */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/[^\s@]+@[^\s@]+/g, '[address]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 200);
}

const TEMPLATES: readonly TemplateKey[] = ['saved-search-match', 'tender-update', 'deadline-reminder', 'tender-corrigendum', 'system-security', 'saved-search-digest'];

/**
 * Sends one notification email (`notification.email`). Status machine (docs/ARCHITECTURE.md Sec 21.7):
 * QUEUED -> SENDING -> SENT, or -> RETRYING on a transient provider error, -> FAILED when retries are exhausted or the
 * error is permanent. A retry after a success that was not acknowledged is a no-op (already SENT).
 */
@Injectable()
@JobProcessor('notification.email')
export class NotificationEmailHandler implements JobHandler<'notification.email'> {
  private readonly logger = new Logger(NotificationEmailHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: EmailTransport,
    private readonly config: AppConfig,
  ) {}

  async handle(payload: JobPayload<'notification.email'>, ctx: JobContext): Promise<JobResult> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: payload.deliveryId },
      include: { notification: true, user: { select: { id: true, email: true, name: true, status: true, deletedAt: true, isEmailVerified: true } } },
    });
    if (!delivery) throw new PermanentJobError(`delivery ${payload.deliveryId} not found`);
    if (delivery.status === 'SENT' || delivery.status === 'DIGESTED') return { status: 'already-sent' };
    if (delivery.status === 'SKIPPED' || delivery.status === 'FAILED') return { status: delivery.status.toLowerCase() };

    const fail = async (reason: string, status: 'FAILED' | 'SKIPPED' = 'FAILED') => {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status, lastError: reason, skipReason: status === 'SKIPPED' ? reason : undefined, failedAt: status === 'FAILED' ? new Date() : undefined },
      });
    };

    if (delivery.user.status !== 'ACTIVE' || delivery.user.deletedAt || !delivery.user.isEmailVerified) {
      await fail('RECIPIENT_UNAVAILABLE', 'SKIPPED');
      return { status: 'skipped', reason: 'RECIPIENT_UNAVAILABLE' };
    }
    if (!(TEMPLATES as readonly string[]).includes(delivery.templateKey)) {
      await fail('INVALID_TEMPLATE');
      throw new PermanentJobError(`unknown template ${delivery.templateKey}`);
    }

    let rendered: RenderedEmail;
    try {
      rendered = await this.render(delivery);
    } catch (err) {
      await fail('RENDER_FAILED');
      throw new PermanentJobError(`render failed: ${sanitizeError(err)}`);
    }

    await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'SENDING', attempts: { increment: 1 } } });
    const started = Date.now();
    try {
      const { messageId } = await this.transport.send({ to: delivery.user.email, template: delivery.templateKey, variables: {}, ...rendered });
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', provider: this.transport.driver, providerMessageId: messageId, sentAt: new Date(), lastError: null },
      });
      this.logger.log({ msg: 'notification email accepted by provider', deliveryId: delivery.id, notificationId: delivery.notificationId, provider: this.transport.driver, attempt: ctx.attempt, durationMs: Date.now() - started });
      return { status: 'sent', provider: this.transport.driver, template: delivery.templateKey };
    } catch (err) {
      const reason = sanitizeError(err);
      if (err instanceof PermanentEmailError) {
        await fail(`PERMANENT: ${reason}`);
        this.logger.error({ msg: 'notification email permanently rejected', deliveryId: delivery.id, code: err.code, attempt: ctx.attempt });
        throw new PermanentJobError(`permanent email failure (${err.code})`);
      }
      if (ctx.isFinalAttempt) await fail(`RETRIES_EXHAUSTED: ${reason}`);
      else await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'RETRYING', lastError: reason } });
      this.logger.warn({ msg: 'notification email attempt failed', deliveryId: delivery.id, attempt: ctx.attempt, final: ctx.isFinalAttempt, error: reason });
      throw err;
    }
  }

  private async render(delivery: {
    id: string;
    templateKey: string;
    notification: { type: string; title: string; message: string; metadata: unknown } | null;
    user: { name: string };
  }): Promise<RenderedEmail> {
    const ctx: RenderContext = { baseUrl: this.config.get('FRONTEND_URL'), recipientName: delivery.user.name, notification: { type: '', title: '', message: '', metadata: {} } };
    if (delivery.notification) {
      ctx.notification = {
        type: delivery.notification.type,
        title: delivery.notification.title,
        message: delivery.notification.message,
        metadata: NotificationMetadataSchema.parse(delivery.notification.metadata),
      };
    } else {
      const members = await this.prisma.notificationDelivery.findMany({
        where: { digestId: delivery.id },
        orderBy: { createdAt: 'asc' },
        include: { notification: { select: { title: true, message: true, entityId: true } } },
      });
      const max = this.config.get('NOTIFY_DIGEST_MAX_ITEMS');
      ctx.items = members.slice(0, max).map((m) => ({ title: m.notification?.title ?? '', message: m.notification?.message ?? '', tenderId: m.notification?.entityId ?? undefined }));
      ctx.moreCount = Math.max(0, members.length - max);
      ctx.notification = { type: 'SAVED_SEARCH_MATCH', title: `Your daily tender digest: ${members.length} new match${members.length === 1 ? '' : 'es'}`, message: '', metadata: {} };
    }
    return renderEmail(delivery.templateKey as TemplateKey, ctx);
  }
}
