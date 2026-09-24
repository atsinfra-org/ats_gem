"use client";

import * as React from "react";

interface AuthDialogValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const AuthDialogContext = React.createContext<AuthDialogValue | null>(null);

export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);

  const value: AuthDialogValue = {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };

  return <AuthDialogContext.Provider value={value}>{children}</AuthDialogContext.Provider>;
}

export function useAuthDialog() {
  const ctx = React.useContext(AuthDialogContext);
  if (!ctx) throw new Error("useAuthDialog must be used within AuthDialogProvider");
  return ctx;
}
