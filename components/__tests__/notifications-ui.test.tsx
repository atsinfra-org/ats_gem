import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card";
import NotificationsPage from "@/app/(app)/notifications/page";
import { SaveSearchModal } from "@/components/search/save-search-modal";
import { NOTIFICATION_POLL_MS, useNotifications } from "@/lib/store/notifications-store";
import { emptyFilters } from "@/lib/search/search-state";
import { ApiError } from "@/lib/api/client";
import type { AppNotification, NotificationPreferences } from "@/lib/api/types";

const list = vi.fn();
const unread = vi.fn();
const markRead = vi.fn();
const markUnread = vi.fn();
const markAll = vi.fn();
const getPrefs = vi.fn();
const putPrefs = vi.fn();
const createSaved = vi.fn();
const refreshUnread = vi.fn();
const storeMarkAll = vi.fn();
let storeUnread = 2;
let authenticated = true;

vi.mock("@/lib/api/notifications", () => ({
  listNotifications: (...a: unknown[]) => list(...a),
  getUnreadCount: (...a: unknown[]) => unread(...a),
  markAsRead: (...a: unknown[]) => markRead(...a),
  markAsUnread: (...a: unknown[]) => markUnread(...a),
  markAllAsRead: (...a: unknown[]) => markAll(...a),
  getPreferences: (...a: unknown[]) => getPrefs(...a),
  updatePreferences: (...a: unknown[]) => putPrefs(...a),
}));
vi.mock("@/lib/api/saved-searches", () => ({ createSavedSearch: (...a: unknown[]) => createSaved(...a) }));
vi.mock("@/lib/auth/session-context", () => ({ useSession: () => ({ isAuthenticated: authenticated }) }));
vi.mock("@/lib/store/auth-dialog-store", () => ({ useAuthDialog: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const n = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: "n1",
  type: "TENDER_UPDATED",
  title: "Tender updated: Road works",
  message: "The closing date is now 20 Oct 2026.",
  entityType: "tender",
  entityId: "0198c1a2-3b4c-7d5e-8f60-123456789abc",
  entityAvailable: true,
  priority: "NORMAL",
  metadata: {},
  isRead: false,
  readAt: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

const page = (items: AppNotification[], extra: Partial<{ total: number; totalPages: number; page: number; unreadCount: number }> = {}) => ({
  notifications: items,
  unreadCount: extra.unreadCount ?? items.filter((i) => !i.isRead).length,
  pagination: { page: extra.page ?? 1, pageSize: 20, total: extra.total ?? items.length, totalPages: extra.totalPages ?? 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
  authenticated = true;
  storeUnread = 2;
  list.mockResolvedValue(page([]));
  unread.mockResolvedValue(0);
  markRead.mockResolvedValue(undefined);
  markUnread.mockResolvedValue(undefined);
  markAll.mockResolvedValue(undefined);
});

// The page reads the shared store for the badge count; a light stand-in keeps these tests about the page.
vi.mock("@/lib/store/notifications-store", async (orig) => {
  const actual = await orig<typeof import("@/lib/store/notifications-store")>();
  return {
    ...actual,
    useNotifications: () => ({ notifications: [], unreadCount: storeUnread, loading: false, error: null, refresh: vi.fn(), refreshUnread: () => refreshUnread(), markRead: vi.fn(), markUnread: vi.fn(), markAllRead: () => storeMarkAll() }),
  };
});

describe("NotificationItem", () => {
  it("links to the tender when it exists, calls onRead, and states unread textually", async () => {
    const onRead = vi.fn();
    render(<ul><NotificationItem notification={n()} onRead={onRead} onToggleRead={vi.fn()} /></ul>);
    const link = screen.getByRole("link", { name: /Tender updated: Road works/ });
    expect(link).toHaveAttribute("href", "/tenders/0198c1a2-3b4c-7d5e-8f60-123456789abc");
    expect(link).toHaveTextContent("Unread.");
    expect(screen.getByText("Tender updated", { selector: "span" })).toBeInTheDocument();
    await userEvent.click(link);
    expect(onRead).toHaveBeenCalled();
  });

  it("never renders a dead link: a removed tender is a plain button with an explanation", () => {
    render(<ul><NotificationItem notification={n({ entityAvailable: false })} onRead={vi.fn()} /></ul>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: /Tender updated/ })).toBeInTheDocument();
    expect(screen.getByText("This tender is no longer available.")).toBeInTheDocument();
  });

  it("non-tender notifications (security) are buttons, show priority as text, and read state has an accessible toggle", async () => {
    const onToggle = vi.fn();
    render(<ul><NotificationItem notification={n({ type: "SECURITY", priority: "CRITICAL", entityType: null, entityId: null, isRead: true, title: "Your password was changed" })} onRead={vi.fn()} onToggleRead={onToggle} /></ul>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText("Unread.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mark as unread: Your password was changed" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("compact mode (bell) hides the summary", () => {
    render(<ul><NotificationItem notification={n()} compact /></ul>);
    expect(screen.queryByText(/closing date is now/)).toBeNull();
  });
});

describe("Notifications page", () => {
  it("shows a loading state, then real notifications with the unread count", async () => {
    list.mockResolvedValue(page([n({ id: "a", title: "First" }), n({ id: "b", title: "Second", isRead: true })], { total: 2 }));
    render(<NotificationsPage />);
    expect(screen.getByLabelText("Loading notifications")).toBeInTheDocument();
    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.getByText("2 unread notifications")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20, type: undefined, unread: false }, expect.anything());
  });

  it("empty state, and an unread-only tab that queries the server", async () => {
    render(<NotificationsPage />);
    expect(await screen.findByText("No notifications")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Unread" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, type: undefined, unread: true }, expect.anything()));
    expect(await screen.findByText("No unread notifications")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    list.mockRejectedValueOnce(new ApiError("DEPENDENCY_UNAVAILABLE", "down", 503)).mockResolvedValue(page([n({ title: "Recovered" })]));
    render(<NotificationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
  });

  it("paginates on the server", async () => {
    list.mockResolvedValue(page([n({ title: "P1" })], { total: 30, totalPages: 2 }));
    render(<NotificationsPage />);
    await screen.findByText("P1");
    list.mockResolvedValue(page([n({ id: "p2", title: "P2" })], { total: 30, totalPages: 2, page: 2 }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("P2")).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, type: undefined, unread: false }, expect.anything());
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("marks one notification read and unread through the API and refreshes the badge", async () => {
    list.mockResolvedValue(page([n({ id: "a", title: "First" })]));
    render(<NotificationsPage />);
    await screen.findByText("First");
    await userEvent.click(screen.getByRole("button", { name: "Mark as read: First" }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("a"));
    expect(refreshUnread).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Mark as unread: First" }));
    await waitFor(() => expect(markUnread).toHaveBeenCalledWith("a"));
  });

  it("rolls the row back when marking read fails", async () => {
    markRead.mockRejectedValue(new ApiError("INTERNAL_ERROR", "boom", 500));
    list.mockResolvedValue(page([n({ id: "a", title: "First" })]));
    render(<NotificationsPage />);
    await screen.findByText("First");
    await userEvent.click(screen.getByRole("button", { name: "Mark as read: First" }));
    expect(await screen.findByRole("button", { name: "Mark as read: First" })).toBeInTheDocument();
  });

  it("Mark all read calls the store and reloads", async () => {
    list.mockResolvedValue(page([n({ title: "First" })]));
    render(<NotificationsPage />);
    await screen.findByText("First");
    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(storeMarkAll).toHaveBeenCalled();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it("links to the preferences", async () => {
    render(<NotificationsPage />);
    expect(await screen.findByRole("link", { name: /Preferences/ })).toHaveAttribute("href", expect.stringContaining("/profile"));
  });
});

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  categories: {
    SAVED_SEARCH_ALERTS: { inApp: true, email: true, locked: false },
    SAVED_TENDER_UPDATES: { inApp: true, email: true, locked: false },
    DEADLINE_REMINDERS: { inApp: true, email: true, locked: false },
    CORRIGENDA: { inApp: true, email: true, locked: false },
    STATUS_CHANGES: { inApp: true, email: true, locked: false },
    SYSTEM: { inApp: true, email: true, locked: true },
  },
  deadlineOffsetsHours: [24],
  allowedDeadlineOffsetsHours: [168, 72, 24, 3],
  quietHours: { enabled: false, start: null, end: null, timezone: "Asia/Kolkata" },
  ...over,
});

describe("NotificationPreferencesCard", () => {
  it("renders the persisted preferences with accessible switches; security is locked on", async () => {
    getPrefs.mockResolvedValue(prefs());
    render(<NotificationPreferencesCard />);
    const corr = await screen.findByRole("switch", { name: "Corrigenda: email notifications" });
    expect(corr).toBeChecked();
    expect(screen.getByRole("switch", { name: "Account and security: email notifications" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Account and security: in-app notifications" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "1 day before" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "3 hours before" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
  });

  it("saves only what changed and shows what the server returned", async () => {
    getPrefs.mockResolvedValue(prefs());
    putPrefs.mockResolvedValue(prefs({ categories: { ...prefs().categories, CORRIGENDA: { inApp: true, email: false, locked: false } }, deadlineOffsetsHours: [3, 24] }));
    render(<NotificationPreferencesCard />);
    await userEvent.click(await screen.findByRole("switch", { name: "Corrigenda: email notifications" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "3 hours before" }));
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(putPrefs).toHaveBeenCalled());
    expect(putPrefs).toHaveBeenCalledWith({ categories: { CORRIGENDA: { inApp: true, email: false } }, deadlineOffsetsHours: [3, 24], quietHours: { enabled: false } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled());
    expect(screen.getByRole("switch", { name: "Corrigenda: email notifications" })).not.toBeChecked();
  });

  it("reveals quiet-hour controls and sends them", async () => {
    getPrefs.mockResolvedValue(prefs());
    putPrefs.mockResolvedValue(prefs({ quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" } }));
    render(<NotificationPreferencesCard />);
    await userEvent.click(await screen.findByRole("switch", { name: "Hold emails during quiet hours" }));
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("22:00");
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(putPrefs).toHaveBeenCalledWith(expect.objectContaining({ quietHours: { enabled: true, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" } })));
  });

  it("shows a server validation message and keeps the draft", async () => {
    getPrefs.mockResolvedValue(prefs());
    putPrefs.mockRejectedValue(new ApiError("VALIDATION_FAILED", "Invalid notification preferences.", 400, [{ message: "Allowed offsets: 168, 72, 24, 3 hours" }]));
    render(<NotificationPreferencesCard />);
    await userEvent.click(await screen.findByRole("switch", { name: "Corrigenda: in-app notifications" }));
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Allowed offsets");
    expect(screen.getByRole("switch", { name: "Corrigenda: in-app notifications" })).not.toBeChecked();
  });

  it("shows a loading state and a retryable error", async () => {
    getPrefs.mockRejectedValueOnce(new ApiError("DEPENDENCY_UNAVAILABLE", "down", 503)).mockResolvedValue(prefs());
    render(<NotificationPreferencesCard />);
    await userEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByRole("switch", { name: "Corrigenda: email notifications" })).toBeInTheDocument();
  });

  it("Reset discards unsaved changes", async () => {
    getPrefs.mockResolvedValue(prefs());
    render(<NotificationPreferencesCard />);
    await userEvent.click(await screen.findByRole("switch", { name: "Corrigenda: email notifications" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("switch", { name: "Corrigenda: email notifications" })).toBeChecked();
  });
});

describe("SaveSearchModal alerts", () => {
  it("alerts default to Off and can be set on save", async () => {
    createSaved.mockResolvedValue({});
    render(<SaveSearchModal open onOpenChange={vi.fn()} keyword="road" filters={emptyFilters} />);
    const select = screen.getByLabelText("Alerts");
    expect(select).toHaveValue("OFF");
    await userEvent.selectOptions(select, "DAILY");
    await userEvent.type(screen.getByLabelText("Search Name"), "Roads");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save Search" }));
    await waitFor(() => expect(createSaved).toHaveBeenCalledWith("Roads", expect.objectContaining({ q: "road" }), "DAILY"));
  });
});

describe("NotificationsProvider polling", () => {
  function Probe() {
    const { unreadCount, notifications } = useNotifications();
    return (
      <p data-testid="probe">
        {unreadCount}:{notifications.length}
      </p>
    );
  }

  it("is not aggressive: one request per minute for the count, list reload only when the count grows, none while hidden", async () => {
    // The provider under test is the real one, so bypass the light stand-in above.
    const real = await vi.importActual<typeof import("@/lib/store/notifications-store")>("@/lib/store/notifications-store");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    list.mockResolvedValue(page([n({ id: "a" })], { unreadCount: 1 }));
    unread.mockResolvedValue(1);
    render(
      <real.NotificationsProvider>
        <ProbeReal use={real.useNotifications} />
      </real.NotificationsProvider>,
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
    });
    expect(unread).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1); // count unchanged: no list reload

    unread.mockResolvedValue(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
    });
    expect(list).toHaveBeenCalledTimes(2); // grew: reload the recent list

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    unread.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 3);
    });
    expect(unread).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    vi.useRealTimers();
    void Probe;
  });
});

function ProbeReal({ use }: { use: () => { unreadCount: number } }) {
  const { unreadCount } = use();
  return <p>{unreadCount}</p>;
}

describe("NotificationsProvider read state", () => {
  it("decrements the unread count when a listed unread notification is marked read, and increments on unread", async () => {
    const real = await vi.importActual<typeof import("@/lib/store/notifications-store")>("@/lib/store/notifications-store");
    list.mockResolvedValue(page([n({ id: "a", isRead: false }), n({ id: "b", isRead: true })], { unreadCount: 1 }));
    function Harness() {
      const { unreadCount, markRead: mr, markUnread: mu } = real.useNotifications();
      return (
        <div>
          <p data-testid="count">{unreadCount}</p>
          <button onClick={() => void mr("a")}>read a</button>
          <button onClick={() => void mr("b")}>read b</button>
          <button onClick={() => void mu("b")}>unread b</button>
        </div>
      );
    }
    render(
      <real.NotificationsProvider>
        <Harness />
      </real.NotificationsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    await userEvent.click(screen.getByRole("button", { name: "read a" }));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(markRead).toHaveBeenCalledWith("a");
    await userEvent.click(screen.getByRole("button", { name: "read b" })); // already read: no change
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    await userEvent.click(screen.getByRole("button", { name: "unread b" }));
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(markUnread).toHaveBeenCalledWith("b");
  });
});
