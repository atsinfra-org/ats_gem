import type { AppNotification } from "@/lib/types";

export const notifications: AppNotification[] = [
  { id: "n1", category: "Tender Alert", title: "12 new tenders match 'Road Works - Maharashtra'", message: "New tenders published in the last 24 hours matching your saved search.", createdAt: "2026-09-24T05:30:00.000Z", read: false },
  { id: "n2", category: "Deadline", title: "Submission closing in 2 days", message: "Construction of Residential Complex — ATS/MH/2026/1042 closes on 26 Sep 2026.", createdAt: "2026-09-24T02:10:00.000Z", read: false },
  { id: "n3", category: "System", title: "Scheduled maintenance completed", message: "Search indexing has been refreshed with the latest tender data.", createdAt: "2026-09-23T22:00:00.000Z", read: true },
  { id: "n4", category: "Subscription", title: "Your Professional plan renews in 5 days", message: "Update your payment method to avoid service interruption.", createdAt: "2026-09-23T09:00:00.000Z", read: false },
  { id: "n5", category: "Account", title: "New login detected", message: "A new sign-in was detected from Mumbai, Maharashtra on Chrome/Windows.", createdAt: "2026-09-22T18:45:00.000Z", read: true },
  { id: "n6", category: "Tender Alert", title: "Tender alert 'IT Services - Pan India' triggered", message: "3 new IT services tenders were published matching your criteria.", createdAt: "2026-09-22T11:20:00.000Z", read: true },
  { id: "n7", category: "Deadline", title: "Bid opening tomorrow", message: "Supply of Medical Equipment — ATS/DL/2026/0871 opens bids tomorrow at 11:00 AM.", createdAt: "2026-09-21T16:00:00.000Z", read: true },
];
