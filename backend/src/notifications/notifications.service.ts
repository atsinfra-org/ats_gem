import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, NotificationMetadataSchema, TEMPLATE_VERSION, type NotificationMetadata, type NotificationType } from './notification-types';

export interface CreateNotificationInput {
  userId: string;
  organizationId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  metadata?: NotificationMetadata;
  /** Deterministic per underlying event; a second create with the same (user, key) is a no-op. */
  dedupKey: string;
  sourceEventId?: string;
  expiresAt?: Date | null;
  /** Stored as already read (used when in-app is switched off but the email channel still needs its record). */
  markRead?: boolean;
}

const PUBLIC_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  entityType: true,
  entityId: true,
  priority: true,
  metadata: true,
  isRead: true,
  readAt: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

export type PublicNotification = Prisma.NotificationGetPayload<{ select: typeof PUBLIC_SELECT }> & { entityAvailable: boolean };

export interface ListNotificationsQuery {
  page: number;
  pageSize: number;
  type?: string;
  unread?: boolean;
}

const visibleNow = (now: Date): Prisma.NotificationWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/**
 * In-app notification records (docs/ARCHITECTURE.md Sec 21). Generation happens asynchronously in the worker; the API
 * only reads and updates the caller's own rows - identity always comes from the authenticated context, never a parameter.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the created row, or `null` when this (user, dedupKey) already had one. */
  async createIfNew(input: CreateNotificationInput): Promise<{ id: string } | null> {
    const def = NOTIFICATION_TYPES[input.type];
    const metadata = NotificationMetadataSchema.parse(input.metadata ?? {});
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId ?? null,
          type: input.type,
          title: input.title.slice(0, 300),
          message: input.message.slice(0, 1000),
          entityType: input.entityId ? 'tender' : null,
          entityId: input.entityId ?? null,
          priority: def.priority,
          metadata: metadata,
          dedupKey: input.dedupKey,
          sourceEventId: input.sourceEventId ?? null,
          templateKey: def.template,
          templateVersion: TEMPLATE_VERSION,
          expiresAt: input.expiresAt ?? null,
          isRead: input.markRead ?? false,
          readAt: input.markRead ? new Date() : null,
        },
        select: { id: true },
      });
      return row;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  async list(userId: string, q: ListNotificationsQuery): Promise<{ items: PublicNotification[]; total: number; unreadCount: number }> {
    if (q.type !== undefined && !(NOTIFICATION_TYPE_KEYS as string[]).includes(q.type)) {
      throw new AppError('VALIDATION_FAILED', 'Unknown notification type.', [{ field: 'type', code: 'INVALID', message: 'unknown type' }]);
    }
    const now = new Date();
    const where: Prisma.NotificationWhereInput = { userId, AND: [visibleNow(now)], ...(q.type ? { type: q.type } : {}), ...(q.unread ? { isRead: false } : {}) };
    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.pageSize, skip: (q.page - 1) * q.pageSize, select: PUBLIC_SELECT }),
      this.prisma.notification.count({ where }),
      this.unreadCount(userId),
    ]);
    const tenderIds = [...new Set(rows.filter((r) => r.entityType === 'tender' && r.entityId).map((r) => r.entityId as string))];
    const live = tenderIds.length ? new Set((await this.prisma.tender.findMany({ where: { id: { in: tenderIds }, deletedAt: null }, select: { id: true } })).map((t) => t.id)) : new Set<string>();
    return { items: rows.map((r) => ({ ...r, entityAvailable: r.entityType === 'tender' ? !!r.entityId && live.has(r.entityId) : r.entityId !== null })), total, unreadCount };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false, AND: [visibleNow(new Date())] } });
  }

  /** 404 for a notification that does not exist *or belongs to someone else* - the two are indistinguishable by design. */
  async setRead(userId: string, id: string, read: boolean): Promise<void> {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: read, readAt: read ? new Date() : null } });
    if (res.count === 0) throw new AppError('NOT_FOUND', 'Notification not found.');
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return { updated: res.count };
  }
}
