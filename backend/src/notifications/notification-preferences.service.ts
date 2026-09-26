import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditLogService } from '../audit/audit-log.service';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import {
  ALLOWED_DEADLINE_OFFSETS_HOURS,
  DEFAULT_CHANNEL_PREFERENCE,
  DEFAULT_DEADLINE_OFFSETS_HOURS,
  LOCKED_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  type NotificationCategoryKey,
} from './notification-types';
import { isValidTimeOfDay, isValidTimeZone, type QuietHours } from './quiet-hours';

export interface ResolvedPreferences {
  inApp: Record<NotificationCategoryKey, boolean>;
  email: Record<NotificationCategoryKey, boolean>;
  deadlineOffsetsHours: number[];
  quiet: QuietHours;
}

export interface PreferencesView {
  categories: Record<NotificationCategoryKey, { inApp: boolean; email: boolean; locked: boolean }>;
  deadlineOffsetsHours: number[];
  allowedDeadlineOffsetsHours: readonly number[];
  quietHours: QuietHours;
}

const channelToggle = z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() }).strict();

export const UpdatePreferencesSchema = z
  .object({
    categories: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), channelToggle).optional(),
    deadlineOffsetsHours: z
      .array(z.number().int())
      .max(ALLOWED_DEADLINE_OFFSETS_HOURS.length)
      .refine((a) => a.every((h) => (ALLOWED_DEADLINE_OFFSETS_HOURS as readonly number[]).includes(h)), { message: `Allowed offsets: ${ALLOWED_DEADLINE_OFFSETS_HOURS.join(', ')} hours` })
      .optional(),
    quietHours: z
      .object({ enabled: z.boolean(), start: z.string().optional(), end: z.string().optional(), timezone: z.string().max(64).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>;

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Effective preferences for many users at once (2 queries total), applying documented defaults and locks. */
  async resolveMany(userIds: string[]): Promise<Map<string, ResolvedPreferences>> {
    const ids = [...new Set(userIds)];
    const [rows, settings] = ids.length
      ? await Promise.all([
          this.prisma.notificationPreference.findMany({ where: { userId: { in: ids } } }),
          this.prisma.notificationSettings.findMany({ where: { userId: { in: ids } } }),
        ])
      : [[], []];
    const out = new Map<string, ResolvedPreferences>();
    for (const id of ids) {
      out.set(id, {
        inApp: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, DEFAULT_CHANNEL_PREFERENCE[c].inApp])) as ResolvedPreferences['inApp'],
        email: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, DEFAULT_CHANNEL_PREFERENCE[c].email])) as ResolvedPreferences['email'],
        deadlineOffsetsHours: [...DEFAULT_DEADLINE_OFFSETS_HOURS],
        quiet: { enabled: false, start: null, end: null, timezone: DEFAULT_TIMEZONE },
      });
    }
    for (const r of rows) {
      const p = out.get(r.userId);
      if (!p || LOCKED_CATEGORIES.includes(r.category)) continue;
      if (r.channel === 'IN_APP') p.inApp[r.category] = r.enabled;
      else p.email[r.category] = r.enabled;
    }
    for (const s of settings) {
      const p = out.get(s.userId);
      if (!p) continue;
      p.deadlineOffsetsHours = [...s.deadlineOffsetsHours].sort((a, b) => a - b);
      p.quiet = { enabled: s.quietHoursEnabled, start: s.quietStart, end: s.quietEnd, timezone: s.timezone };
    }
    return out;
  }

  async get(userId: string): Promise<PreferencesView> {
    const resolved = (await this.resolveMany([userId])).get(userId)!;
    return {
      categories: Object.fromEntries(
        NOTIFICATION_CATEGORIES.map((c) => [c, { inApp: resolved.inApp[c], email: resolved.email[c], locked: LOCKED_CATEGORIES.includes(c) }]),
      ) as PreferencesView['categories'],
      deadlineOffsetsHours: resolved.deadlineOffsetsHours,
      allowedDeadlineOffsetsHours: ALLOWED_DEADLINE_OFFSETS_HOURS,
      quietHours: resolved.quiet,
    };
  }

  async update(userId: string, raw: unknown): Promise<PreferencesView> {
    const parsed = UpdatePreferencesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Invalid notification preferences.', parsed.error.issues.slice(0, 5).map((i) => ({ field: i.path.join('.'), code: 'INVALID', message: i.message })));
    }
    const input = parsed.data;

    for (const [category, toggle] of Object.entries(input.categories ?? {})) {
      if (LOCKED_CATEGORIES.includes(category as NotificationCategoryKey) && (toggle.inApp === false || toggle.email === false)) {
        throw new AppError('VALIDATION_FAILED', 'Security and account notifications cannot be turned off.', [{ field: `categories.${category}`, code: 'LOCKED', message: 'locked category' }]);
      }
    }

    let quiet: { quietHoursEnabled: boolean; quietStart: string | null; quietEnd: string | null; timezone?: string } | undefined;
    if (input.quietHours) {
      const q = input.quietHours;
      if (q.enabled && (!q.start || !q.end || !isValidTimeOfDay(q.start) || !isValidTimeOfDay(q.end))) {
        throw new AppError('VALIDATION_FAILED', 'Quiet hours need a start and end time (HH:mm).', [{ field: 'quietHours', code: 'INVALID', message: 'start/end required' }]);
      }
      if (q.timezone !== undefined && !isValidTimeZone(q.timezone)) {
        throw new AppError('VALIDATION_FAILED', 'Unknown time zone.', [{ field: 'quietHours.timezone', code: 'INVALID', message: 'unknown time zone' }]);
      }
      if (!q.enabled && ((q.start && !isValidTimeOfDay(q.start)) || (q.end && !isValidTimeOfDay(q.end)))) {
        throw new AppError('VALIDATION_FAILED', 'Times must be HH:mm.', [{ field: 'quietHours', code: 'INVALID', message: 'bad time' }]);
      }
      quiet = { quietHoursEnabled: q.enabled, quietStart: q.start ?? null, quietEnd: q.end ?? null, timezone: q.timezone };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [category, toggle] of Object.entries(input.categories ?? {})) {
        for (const [channel, enabled] of [['IN_APP', toggle.inApp], ['EMAIL', toggle.email]] as const) {
          if (enabled === undefined) continue;
          await tx.notificationPreference.upsert({
            where: { userId_category_channel: { userId, category: category as NotificationCategoryKey, channel } },
            create: { userId, category: category as NotificationCategoryKey, channel, enabled },
            update: { enabled },
          });
        }
      }
      if (input.deadlineOffsetsHours || quiet) {
        const data = {
          ...(input.deadlineOffsetsHours ? { deadlineOffsetsHours: [...new Set(input.deadlineOffsetsHours)].sort((a, b) => a - b) } : {}),
          ...(quiet ? { quietHoursEnabled: quiet.quietHoursEnabled, quietStart: quiet.quietStart, quietEnd: quiet.quietEnd, ...(quiet.timezone ? { timezone: quiet.timezone } : {}) } : {}),
        };
        await tx.notificationSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      }
      await this.audit.record({ actorUserId: userId, action: 'NOTIFICATION_PREFERENCES_UPDATED', resourceType: 'user', resourceId: userId, newValue: JSON.parse(JSON.stringify(input)) as Record<string, unknown> }, tx);
    });
    return this.get(userId);
  }
}
