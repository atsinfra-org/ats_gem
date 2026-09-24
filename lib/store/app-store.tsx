"use client";

import * as React from "react";
import { tenders as allTenders } from "@/lib/mock/tenders";
import { savedSearches as initialSavedSearches } from "@/lib/mock/alerts";
import { tenderAlerts as initialAlerts } from "@/lib/mock/alerts";
import { notifications as initialNotifications } from "@/lib/mock/notifications";
import type { SavedSearch, TenderAlert, AppNotification } from "@/lib/types";

interface AppStoreValue {
  savedTenderIds: string[];
  isSaved: (id: string) => boolean;
  toggleSaveTender: (id: string) => boolean;
  savedSearches: SavedSearch[];
  addSavedSearch: (search: Omit<SavedSearch, "id" | "lastUpdated" | "matchCount">) => void;
  removeSavedSearch: (id: string) => void;
  alerts: TenderAlert[];
  toggleAlertStatus: (id: string) => void;
  removeAlert: (id: string) => void;
  addAlert: (alert: Omit<TenderAlert, "id" | "lastTriggered" | "status">) => void;
  notifications: AppNotification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
}

const AppStoreContext = React.createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [savedTenderIds, setSavedTenderIds] = React.useState<string[]>(() =>
    allTenders.slice(0, 5).map((t) => t.id)
  );
  const [savedSearches, setSavedSearches] = React.useState<SavedSearch[]>(initialSavedSearches);
  const [alerts, setAlerts] = React.useState<TenderAlert[]>(initialAlerts);
  const [notifications, setNotifications] = React.useState<AppNotification[]>(initialNotifications);

  const isSaved = React.useCallback((id: string) => savedTenderIds.includes(id), [savedTenderIds]);

  const toggleSaveTender = React.useCallback((id: string) => {
    let nowSaved = false;
    setSavedTenderIds((prev) => {
      if (prev.includes(id)) {
        nowSaved = false;
        return prev.filter((x) => x !== id);
      }
      nowSaved = true;
      return [...prev, id];
    });
    return nowSaved;
  }, []);

  const addSavedSearch = React.useCallback((search: Omit<SavedSearch, "id" | "lastUpdated" | "matchCount">) => {
    setSavedSearches((prev) => [
      {
        ...search,
        id: `ss-${Date.now()}`,
        lastUpdated: new Date().toISOString(),
        matchCount: Math.floor(Math.random() * 40) + 1,
      },
      ...prev,
    ]);
  }, []);

  const removeSavedSearch = React.useCallback((id: string) => {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const toggleAlertStatus = React.useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: a.status === "active" ? "paused" : "active" } : a))
    );
  }, []);

  const removeAlert = React.useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const addAlert = React.useCallback((alert: Omit<TenderAlert, "id" | "lastTriggered" | "status">) => {
    setAlerts((prev) => [
      { ...alert, id: `al-${Date.now()}`, lastTriggered: null, status: "active" },
      ...prev,
    ]);
  }, []);

  const markNotificationRead = React.useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllNotificationsRead = React.useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = React.useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const value: AppStoreValue = {
    savedTenderIds,
    isSaved,
    toggleSaveTender,
    savedSearches,
    addSavedSearch,
    removeSavedSearch,
    alerts,
    toggleAlertStatus,
    removeAlert,
    addAlert,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
  };

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const ctx = React.useContext(AppStoreContext);
  if (!ctx) throw new Error("useAppStore must be used within AppStoreProvider");
  return ctx;
}
