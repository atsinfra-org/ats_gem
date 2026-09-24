import type { TenderAlert, SavedSearch } from "@/lib/types";

export const tenderAlerts: TenderAlert[] = [
  { id: "al1", name: "Road Works - Maharashtra", criteria: "Category: Road Works · State: Maharashtra", frequency: "Instant", channels: ["Email", "SMS"], status: "active", lastTriggered: "2026-09-24T05:30:00.000Z" },
  { id: "al2", name: "IT Services - Pan India", criteria: "Category: IT Services · Value: > ₹10L", frequency: "Daily", channels: ["Email"], status: "active", lastTriggered: "2026-09-22T11:20:00.000Z" },
  { id: "al3", name: "Medical Equipment - Delhi NCR", criteria: "Category: Medical Equipment · Location: Delhi", frequency: "Weekly", channels: ["Email", "WhatsApp"], status: "paused", lastTriggered: "2026-09-10T09:00:00.000Z" },
  { id: "al4", name: "Solar & Renewable - Gujarat", criteria: "Category: Solar & Renewable Energy · State: Gujarat", frequency: "Instant", channels: ["Email"], status: "active", lastTriggered: null },
];

export const savedSearches: SavedSearch[] = [
  { id: "ss1", name: "Road Works - Maharashtra", keywords: "road construction highway", filters: ["State: Maharashtra", "Category: Road Works"], matchCount: 38, lastUpdated: "2026-09-23T00:00:00.000Z", alertsEnabled: true },
  { id: "ss2", name: "IT Services - Pan India", keywords: "software development IT services", filters: ["Category: IT Services", "Value: > ₹10L"], matchCount: 21, lastUpdated: "2026-09-22T00:00:00.000Z", alertsEnabled: true },
  { id: "ss3", name: "Medical Equipment - Delhi NCR", keywords: "medical equipment supply", filters: ["Category: Medical Equipment", "Location: Delhi"], matchCount: 14, lastUpdated: "2026-09-18T00:00:00.000Z", alertsEnabled: false },
  { id: "ss4", name: "Solar Projects - Gujarat", keywords: "solar renewable energy", filters: ["Category: Solar & Renewable Energy", "State: Gujarat"], matchCount: 9, lastUpdated: "2026-09-15T00:00:00.000Z", alertsEnabled: true },
];
