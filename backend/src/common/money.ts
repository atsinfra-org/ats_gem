import type { Prisma } from '../generated/prisma/client';

export interface Money {
  amount: string;
  currency: string;
}

/** docs/API-CONTRACT.md §1.2: money is `{ amount: string, currency }` — never a float on the wire. */
export function toMoney(amount: Prisma.Decimal | null, currency: string): Money | null {
  return amount ? { amount: amount.toFixed(2), currency } : null;
}
