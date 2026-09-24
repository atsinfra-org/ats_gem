export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  ip: string;
}

export const auditLogs: AuditLog[] = [
  { id: "log-1", actor: "admin@atsgem.com", action: "Updated tender status", target: "ATS/MH/2026/1042", timestamp: "2026-09-24T05:12:00.000Z", ip: "103.21.244.10" },
  { id: "log-2", actor: "rohan.mehta@buildtech.in", action: "Downloaded document", target: "BOQ.xlsx", timestamp: "2026-09-24T04:40:00.000Z", ip: "49.36.88.201" },
  { id: "log-3", actor: "admin@atsgem.com", action: "Suspended user", target: "karan@enterprise-co.in", timestamp: "2026-09-23T14:20:00.000Z", ip: "103.21.244.10" },
  { id: "log-4", actor: "system", action: "Crawler source failed", target: "IREPS", timestamp: "2026-09-23T23:00:00.000Z", ip: "internal" },
  { id: "log-5", actor: "ananya.iyer@infracorp.in", action: "Created saved search", target: "IT Services - Pan India", timestamp: "2026-09-22T11:15:00.000Z", ip: "117.198.40.5" },
  { id: "log-6", actor: "admin@atsgem.com", action: "Updated platform settings", target: "Crawler Settings", timestamp: "2026-09-21T09:05:00.000Z", ip: "103.21.244.10" },
];
