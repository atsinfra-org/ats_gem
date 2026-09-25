import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Notification } from '../generated/prisma/client';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

/**
 * In-app notification records only (docs/ARCHITECTURE.md §16 foundation note): nothing here sends
 * an email, SMS or push — that fan-out, plus preferences and digests, is Phase 7. Other services
 * call `create()` directly; there is no API to create a notification for someone else.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }

  async listForUser(userId: string): Promise<{ notifications: Notification[]; unreadCount: number }> {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { notifications, unreadCount };
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
  }
}
