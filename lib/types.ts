export type TenderStatus =
  | "open"
  | "closing_soon"
  | "limited"
  | "eoi"
  | "rfp"
  | "closed";

export type TenderType =
  | "Open Tender"
  | "Limited Tender"
  | "EOI"
  | "RFP"
  | "Single Tender"
  | "Global Tender";

export interface TenderDocument {
  id: string;
  name: string;
  type: "pdf" | "xlsx" | "zip" | "docx";
  sizeKb: number;
}

export interface Tender {
  id: string;
  tenderId: string;
  title: string;
  department: string;
  organization: string;
  location: string;
  state: string;
  category: string;
  industry: string;
  tenderType: TenderType;
  status: TenderStatus;
  estimatedValue: number;
  emdAmount: number;
  documentFee: number;
  publishedDate: string;
  documentDownloadStart: string;
  submissionDeadline: string;
  bidOpeningDate: string;
  source: string;
  description: string;
  eligibility: string[];
  technicalRequirements: string[];
  financialRequirements: string[];
  termsAndConditions: string[];
  biddingProcess: string[];
  documents: TenderDocument[];
}

export interface SavedSearch {
  id: string;
  name: string;
  keywords: string;
  filters: string[];
  matchCount: number;
  lastUpdated: string;
  alertsEnabled: boolean;
}

export interface TenderAlert {
  id: string;
  name: string;
  criteria: string;
  frequency: "Instant" | "Daily" | "Weekly";
  channels: string[];
  status: "active" | "paused";
  lastTriggered: string | null;
}

export type NotificationCategory =
  | "Tender Alert"
  | "Deadline"
  | "System"
  | "Subscription"
  | "Account";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  plan: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  company: string;
  plan: string;
  status: "active" | "suspended" | "invited";
  joined: string;
  lastActive: string;
}

export interface StateSnapshot {
  code: string;
  name: string;
  live: number;
  closingWeekCr: number;
  topBuyer: string;
}

export interface BuyerSnapshot {
  name: string;
  short: string;
  live: number;
  valueCr: number;
}

export interface ValueBand {
  label: string;
  short: string;
  count: number;
  underOneCrore: boolean;
}

export interface PortalSnapshot {
  name: string;
  status: "ok" | "delayed" | "down";
  syncedMinutesAgo: number;
  today: number;
}

export interface MarketSnapshot {
  liveTenders: number;
  closingThisWeekCr: number;
  sources: number;
  lastCrawlMinutesAgo: number;
  states: StateSnapshot[];
  topBuyers: BuyerSnapshot[];
  valueBands: ValueBand[];
  portals: PortalSnapshot[];
}

export interface WireItem {
  id: string;
  title: string;
  department: string;
  value: number;
  stateName: string;
  stateCode: string;
}

export interface ClosingItem {
  id: string;
  title: string;
  department: string;
  deadline: string;
}

export interface AdminSource {
  id: string;
  name: string;
  type: string;
  status: "active" | "paused" | "error" | "pending";
  lastCrawl: string;
  tendersFound: number;
  successRate: number;
}
