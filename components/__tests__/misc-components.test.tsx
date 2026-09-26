import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DocumentCard } from "@/components/documents/document-card";
import { FilterPanel, emptyFilters } from "@/components/search/filter-panel";
import { TenderTabs } from "@/components/tender/tender-tabs";
import type { AppNotification, TenderDetail, TenderDocumentSummary } from "@/lib/api/types";

const markRead = vi.fn();
const markAllRead = vi.fn();
let auth = true;
let notes: AppNotification[] = [];
vi.mock("@/lib/auth/session-context", () => ({ useSession: () => ({ isAuthenticated: auth }) }));
vi.mock("@/lib/store/notifications-store", () => ({
  useNotifications: () => ({ notifications: notes, unreadCount: notes.filter((n) => !n.isRead).length, markRead, markAllRead }),
}));
vi.mock("@/lib/api/taxonomy", () => ({
  listStates: () => Promise.resolve([{ code: "MH", name: "Maharashtra", type: "STATE" }]),
  listCategories: () => Promise.resolve([{ id: "c1", name: "Roads", slug: "roads", parentId: null, industry: null }]),
  listTenderTypes: () => Promise.resolve([{ key: "OPEN", name: "Open Tender" }]),
  listSources: () => Promise.resolve([]),
  listDistricts: () => Promise.resolve([]),
}));
vi.mock("@/lib/store/auth-dialog-store", () => ({ useAuthDialog: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }) }));
const fetchAll = vi.fn();
vi.mock("@/lib/api/tender-parts", async (orig) => ({ ...(await orig<object>()), fetchAllPages: (...a: unknown[]) => fetchAll(...a) }));

const note = (over: Partial<AppNotification>): AppNotification => ({
  id: "n1", type: "x", title: "Hello", message: "m", entityType: null, entityId: null, entityAvailable: false, priority: "NORMAL", metadata: {}, isRead: false, readAt: null, expiresAt: null, createdAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth = true;
  notes = [];
});

describe("NotificationBell", () => {
  it("renders nothing when signed out", () => {
    auth = false;
    const { container } = render(<NotificationBell />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the unread count in its accessible name and marks an item read", async () => {
    notes = [note({ id: "a", title: "First" }), note({ id: "b", title: "Second", isRead: true })];
    render(<NotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: "Notifications (1 unread)" }));
    await userEvent.click(await screen.findByText("First"));
    expect(markRead).toHaveBeenCalledWith("a");
  });

  it("shows an empty state", async () => {
    render(<NotificationBell />);
    await userEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });
});

const doc: TenderDocumentSummary = { id: "d1", documentType: "NIT", fileName: "nit.pdf", version: 2, status: "DOWNLOADED", sourceUrl: null, createdAt: "2026-09-01T00:00:00Z" };

describe("DocumentCard", () => {
  it("shows metadata, a real download link and triggers preview", async () => {
    const onPreview = vi.fn();
    render(<DocumentCard tenderId="t1" document={doc} onPreview={onPreview} />);
    expect(screen.getByText("nit.pdf")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", expect.stringContaining("/tenders/t1/documents/d1/download"));
    await userEvent.click(screen.getByRole("button", { name: "Preview nit.pdf" }));
    expect(onPreview).toHaveBeenCalledWith(doc);
  });
});

describe("FilterPanel", () => {
  it("reports changes; compact hides the value range", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    expect(screen.getByText("Estimated Value (₹)")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Min"), "5");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minValue: "5" }));
    rerender(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} compact />);
    expect(screen.queryByText("Estimated Value (₹)")).toBeNull();
  });

  it("Clear All calls onClear", async () => {
    const onClear = vi.fn();
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(onClear).toHaveBeenCalled();
  });
});

const base: TenderDetail = {
  id: "t1", referenceNumber: null, title: "T", department: null, procuringEntity: null, category: null, status: "OPEN", state: null, city: null,
  estimatedValue: null, emdAmount: null, publishedAt: "2026-09-01T00:00:00Z", closingAt: null, isSaved: false, description: null, subCategory: null,
  tenderType: null, procurementType: null, locationText: null, tenderFee: null, openingAt: null, primarySourceUrl: null, sourceStatusRaw: null, duplicateOfId: null,
  documents: [], requirements: [], timeline: [], corrigenda: [], versions: [], qualityIssues: [], provenance: [], lastSyncedAt: "2026-09-01T00:00:00Z",
};
const reqs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, type: "FINANCIAL", title: `Req ${i}`, description: null, value: null, unit: null, isMandatory: true }));

describe("TenderTabs", () => {
  it("renders versions (with field diffs) and provenance from the API data", async () => {
    render(
      <TenderTabs
        tender={{
          ...base,
          versions: [{ version: 2, changeType: "CORRIGENDUM", detectedAt: "2026-09-05T00:00:00Z", diff: { closingAt: { from: "a", to: "b" } } }],
          provenance: [{ sourceId: "src-1", sourceUrl: "https://portal.example/t/1", firstSeenAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-09-05T00:00:00Z", lastChangedAt: "2026-09-05T00:00:00Z" }],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: /Versions/ }));
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("CORRIGENDUM")).toBeInTheDocument();
    expect(screen.getByText("closingAt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByText("src-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://portal.example/t/1" })).toBeInTheDocument();
  });

  it("shows honest empty states", async () => {
    render(<TenderTabs tender={base} />);
    await userEvent.click(screen.getByRole("tab", { name: "Requirements" }));
    expect(screen.getByText(/No structured requirements/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByText(/No timeline events/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Corrigenda" }));
    expect(screen.getByText(/No corrigenda/)).toBeInTheDocument();
  });

  it("offers Load all at the preview cap and shows every row afterwards", async () => {
    fetchAll.mockResolvedValue(reqs(25));
    render(<TenderTabs tender={{ ...base, requirements: reqs(20) }} />);
    await userEvent.click(screen.getByRole("tab", { name: "Requirements" }));
    expect(screen.getByText("Req 19")).toBeInTheDocument();
    expect(screen.queryByText("Req 24")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Load all" }));
    await waitFor(() => expect(screen.getByText("Req 24")).toBeInTheDocument());
    expect(fetchAll).toHaveBeenCalledWith("t1", "requirements");
  });

  it("shows an error state when loading all fails", async () => {
    fetchAll.mockRejectedValue(new Error("boom"));
    render(<TenderTabs tender={{ ...base, requirements: reqs(20) }} />);
    await userEvent.click(screen.getByRole("tab", { name: "Requirements" }));
    await userEvent.click(screen.getByRole("button", { name: "Load all" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("does not offer Load all below the cap", async () => {
    render(<TenderTabs tender={{ ...base, requirements: reqs(3) }} />);
    await userEvent.click(screen.getByRole("tab", { name: "Requirements" }));
    expect(screen.queryByRole("button", { name: "Load all" })).toBeNull();
  });
});
