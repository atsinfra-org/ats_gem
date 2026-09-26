import { apiRequest, apiRequestWithMeta } from "./client";
import type { AppNotification, NotificationPreferences, Pagination } from "./types";

export interface NotificationQuery {
  page?: number;
  pageSize?: number;
  type?: string;
  unread?: boolean;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unreadCount: number;
  pagination: Pagination;
}

export async function listNotifications(query: NotificationQuery = {}, signal?: AbortSignal): Promise<NotificationPage> {
  const { data, meta } = await apiRequestWithMeta<AppNotification[]>("/notifications", {
    query: { page: query.page, pageSize: query.pageSize, type: query.type || undefined, unread: query.unread ? "true" : undefined },
    signal,
  });
  return { notifications: data, unreadCount: (meta.unreadCount as number) ?? 0, pagination: meta.pagination as Pagination };
}

export async function getUnreadCount(signal?: AbortSignal): Promise<number> {
  return (await apiRequest<{ unreadCount: number }>("/notifications/unread-count", { signal })).unreadCount;
}

export async function markAsRead(id: string): Promise<void> {
  await apiRequest(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAsUnread(id: string): Promise<void> {
  await apiRequest(`/notifications/${id}/unread`, { method: "PATCH" });
}

export async function markAllAsRead(): Promise<void> {
  await apiRequest("/notifications/read-all", { method: "PATCH" });
}

export function getPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>("/notifications/preferences", { signal });
}

export interface PreferencesUpdate {
  categories?: Partial<Record<string, { inApp?: boolean; email?: boolean }>>;
  deadlineOffsetsHours?: number[];
  quietHours?: { enabled: boolean; start?: string; end?: string; timezone?: string };
}

export function updatePreferences(update: PreferencesUpdate): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>("/notifications/preferences", { method: "PATCH", body: update });
}
