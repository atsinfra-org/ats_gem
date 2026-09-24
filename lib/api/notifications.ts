import { notifications } from "@/lib/mock/notifications";
import type { AppNotification } from "@/lib/types";

const delay = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listNotifications(): Promise<AppNotification[]> {
  await delay();
  return notifications;
}

export async function markAsRead(_id: string): Promise<{ success: true }> {
  await delay(100);
  return { success: true };
}

export async function markAllAsRead(): Promise<{ success: true }> {
  await delay(150);
  return { success: true };
}
