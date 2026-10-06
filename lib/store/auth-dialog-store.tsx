"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session-context";

interface AuthDialogValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const AuthDialogContext = React.createContext<AuthDialogValue | null>(null);

export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const router = useRouter();
  const { isAuthenticated, sessionExpired } = useSession();

  const value: AuthDialogValue = {
    isOpen,
    // Sign-in and sign-up CTAs are everywhere on the public pages; someone already signed in goes
    // straight to their dashboard instead of a login form. An expired session still gets the dialog.
    open: () => (isAuthenticated && !sessionExpired ? router.push("/dashboard") : setIsOpen(true)),
    close: () => setIsOpen(false),
  };

  return <AuthDialogContext.Provider value={value}>{children}</AuthDialogContext.Provider>;
}

export function useAuthDialog() {
  const ctx = React.useContext(AuthDialogContext);
  if (!ctx) throw new Error("useAuthDialog must be used within AuthDialogProvider");
  return ctx;
}
