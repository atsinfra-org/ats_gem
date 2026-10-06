"use client";

import * as React from "react";
import { apiRequest } from "@/lib/api/client";
import { bootstrapSession, onSessionExpired, setAccessToken } from "@/lib/api/client";
import { logoutRequest } from "@/lib/api/client";
import { track } from "@/lib/analytics/client";
import type { MeProfile } from "@/lib/api/types";

interface SessionValue {
  /** `undefined` while the initial silent-refresh attempt is in flight. */
  user: MeProfile | null | undefined;
  isAuthenticated: boolean;
  /** Set the session after a successful login/register (access token already stored by lib/api/auth). */
  setSession: (user: MeProfile) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  sessionExpired: boolean;
  dismissSessionExpired: () => void;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<MeProfile | null | undefined>(undefined);
  const [sessionExpired, setSessionExpired] = React.useState(false);

  const refreshUser = React.useCallback(async () => {
    try {
      const me = await apiRequest<MeProfile>("/me");
      setUser(me);
    } catch {
      setUser(null);
      setAccessToken(null);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await bootstrapSession();
      if (cancelled) return;
      if (restored) await refreshUser();
      else setUser(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  React.useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);

  const setSession = React.useCallback((profile: MeProfile) => {
    setUser(profile);
    setSessionExpired(false);
  }, []);

  const logout = React.useCallback(async () => {
    track("LOGOUT");
    await logoutRequest();
    setUser(null);
  }, []);

  const value: SessionValue = {
    user,
    isAuthenticated: !!user,
    setSession,
    refreshUser,
    logout,
    sessionExpired,
    dismissSessionExpired: () => setSessionExpired(false),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
