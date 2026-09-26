import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompactINR(value: number): string {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(2)} Lakh`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value}`;
}

/** Compact elapsed time for tickers and sync status: "now", "12m", "3h", "2d". */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface MoneyLike {
  amount: string;
  currency: string;
}

/** Formats a backend `Money` value ({ amount: "12345.00", currency: "INR" }) - `null` becomes "Not disclosed". */
export function formatMoney(money: MoneyLike | null | undefined): string {
  if (!money) return "Not disclosed";
  const value = Number(money.amount);
  if (!Number.isFinite(value)) return "Not disclosed";
  if (money.currency !== "INR") return new Intl.NumberFormat("en-IN", { style: "currency", currency: money.currency, maximumFractionDigits: 0 }).format(value);
  return formatCompactINR(value);
}

export function hasPassed(dateStr: string): boolean {
  return new Date(dateStr).getTime() < Date.now();
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}
