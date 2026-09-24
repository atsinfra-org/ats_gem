import type { AdminSource } from "@/lib/types";

export const adminSources: AdminSource[] = [
  { id: "s1", name: "GeM Portal", type: "Government e-Marketplace", status: "active", lastCrawl: "2026-09-24T04:00:00.000Z", tendersFound: 4820, successRate: 98.4 },
  { id: "s2", name: "CPPP eProcurement", type: "Central Government", status: "active", lastCrawl: "2026-09-24T03:30:00.000Z", tendersFound: 3120, successRate: 96.1 },
  { id: "s3", name: "Maharashtra eTender Portal", type: "State Government", status: "active", lastCrawl: "2026-09-24T02:15:00.000Z", tendersFound: 1240, successRate: 94.7 },
  { id: "s4", name: "IREPS", type: "Railways", status: "error", lastCrawl: "2026-09-23T23:00:00.000Z", tendersFound: 640, successRate: 71.2 },
  { id: "s5", name: "MSTC eProcurement", type: "PSU", status: "paused", lastCrawl: "2026-09-20T10:00:00.000Z", tendersFound: 380, successRate: 88.9 },
  { id: "s6", name: "Delhi Jal Board Portal", type: "Municipal", status: "pending", lastCrawl: "—", tendersFound: 0, successRate: 0 },
  { id: "s7", name: "Karnataka RIDC", type: "State Government", status: "active", lastCrawl: "2026-09-24T01:45:00.000Z", tendersFound: 512, successRate: 92.3 },
];
