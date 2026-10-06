import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteTracker } from "@/components/analytics/route-tracker";
import { TenderViewTracker } from "@/components/analytics/tender-view-tracker";
import { NotificationItem } from "@/components/notifications/notification-item";
import { SaveTenderButton } from "@/components/tender/save-tender-button";
import type { AppNotification } from "@/lib/api/types";

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

let pathname = "/tenders";
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

const toggle = vi.fn();
let saved = false;
vi.mock("@/lib/store/watchlist-store", () => ({ useWatchlist: () => ({ isSaved: () => saved, toggle }) }));

beforeEach(() => {
  vi.clearAllMocks();
  pathname = "/tenders";
  saved = false;
});

describe("RouteTracker", () => {
  it("fires one PAGE_VIEW with the pathname and route category on mount", () => {
    render(<RouteTracker />);
    expect(track).toHaveBeenCalledWith("PAGE_VIEW", { path: "/tenders", metadata: { routeCategory: "app" } });
  });

  it("classifies public, auth and admin routes correctly", () => {
    pathname = "/about";
    const { rerender } = render(<RouteTracker />);
    expect(track).toHaveBeenLastCalledWith("PAGE_VIEW", { path: "/about", metadata: { routeCategory: "public" } });
    pathname = "/login";
    rerender(<RouteTracker />);
    expect(track).toHaveBeenLastCalledWith("PAGE_VIEW", { path: "/login", metadata: { routeCategory: "auth" } });
    pathname = "/admin/procuring-entities";
    rerender(<RouteTracker />);
    expect(track).toHaveBeenLastCalledWith("PAGE_VIEW", { path: "/admin/procuring-entities", metadata: { routeCategory: "admin" } });
  });

  it("does not fire again for the same pathname, only when it changes", () => {
    const { rerender } = render(<RouteTracker />);
    expect(track).toHaveBeenCalledTimes(1);
    rerender(<RouteTracker />);
    expect(track).toHaveBeenCalledTimes(1);
    pathname = "/dashboard";
    rerender(<RouteTracker />);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("never sends a query string, and skips sensitive auth-token pages entirely", () => {
    pathname = "/reset-password";
    render(<RouteTracker />);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("TenderViewTracker", () => {
  it("fires TENDER_VIEWED with the tender id and a validated source", () => {
    render(<TenderViewTracker tenderId="t1" />);
    expect(track).toHaveBeenCalledWith("TENDER_VIEWED", { entityType: "tender", entityId: "t1", metadata: { tenderId: "t1", source: "direct" } });
  });

  it("uses a known source from the URL and falls back to direct for an unknown one", () => {
    searchParams.set("from", "search");
    render(<TenderViewTracker tenderId="t2" />);
    expect(track).toHaveBeenCalledWith("TENDER_VIEWED", { entityType: "tender", entityId: "t2", metadata: { tenderId: "t2", source: "search" } });
    searchParams.set("from", "hacked-source");
    render(<TenderViewTracker tenderId="t3" />);
    expect(track).toHaveBeenCalledWith("TENDER_VIEWED", { entityType: "tender", entityId: "t3", metadata: { tenderId: "t3", source: "direct" } });
    searchParams.delete("from");
  });
});

describe("save/unsave tracking", () => {
  it("tracks TENDER_SAVED and TENDER_UNSAVED without changing the button's behavior", async () => {
    const { rerender } = render(<SaveTenderButton tenderId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "Save tender" }));
    expect(track).toHaveBeenCalledWith("TENDER_SAVED", { entityType: "tender", entityId: "t1", metadata: { tenderId: "t1", source: "detail" } });
    expect(toggle).toHaveBeenCalledWith("t1");
    saved = true;
    rerender(<SaveTenderButton tenderId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "Remove from saved tenders" }));
    expect(track).toHaveBeenCalledWith("TENDER_UNSAVED", { entityType: "tender", entityId: "t1", metadata: { tenderId: "t1" } });
  });
});

describe("notification click tracking", () => {
  const note: AppNotification = {
    id: "n1",
    type: "TENDER_UPDATED",
    title: "Updated",
    message: "m",
    entityType: "tender",
    entityId: "t1",
    entityAvailable: true,
    priority: "NORMAL",
    metadata: {},
    isRead: false,
    readAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
  };

  it("fires NOTIFICATION_CLICKED and still calls the existing onRead handler", async () => {
    const onRead = vi.fn();
    render(<ul><NotificationItem notification={note} onRead={onRead} /></ul>);
    await userEvent.click(screen.getByRole("link"));
    expect(track).toHaveBeenCalledWith("NOTIFICATION_CLICKED", { entityType: "notification", entityId: "n1", metadata: { notificationId: "n1", type: "TENDER_UPDATED" } });
    await waitFor(() => expect(onRead).toHaveBeenCalled());
  });
});
