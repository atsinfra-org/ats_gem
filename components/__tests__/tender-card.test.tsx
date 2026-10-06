import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TenderCard } from "@/components/tender/tender-card";
import { SaveTenderButton } from "@/components/tender/save-tender-button";
import type { TenderSummary } from "@/lib/api/types";

const toggle = vi.fn();
let saved = false;
vi.mock("@/lib/store/watchlist-store", () => ({ useWatchlist: () => ({ isSaved: () => saved, toggle, savedTenderIds: new Set(), loading: false }) }));

const tender: TenderSummary = {
  id: "11111111-1111-1111-1111-111111111111",
  referenceNumber: "PWD/2026/0001",
  title: "Construction of bypass road",
  department: "PWD",
  procuringEntity: { id: "e1", name: "Public Works Department", entityType: "OTHER" },
  category: { id: "c1", name: "Roads" },
  status: "OPEN",
  state: "MH",
  city: "Pune",
  estimatedValue: { amount: "15000000.00", currency: "INR" },
  emdAmount: null,
  publishedAt: "2026-09-01T00:00:00.000Z",
  closingAt: "2099-01-01T00:00:00.000Z",
  isSaved: false,
};

describe("TenderCard", () => {
  it("renders real fields and links to the detail page", () => {
    render(<TenderCard tender={tender} />);
    expect(screen.getByRole("heading", { name: "Construction of bypass road" })).toBeInTheDocument();
    expect(screen.getByText("Public Works Department")).toBeInTheDocument();
    expect(screen.getByText("Value: ₹1.50 Cr")).toBeInTheDocument();
    expect(screen.getByText("EMD: Not disclosed")).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === `/tenders/${tender.id}`)).toBe(true);
  });

  it("omits the deadline badge and shows a placeholder location when data is missing", () => {
    render(<TenderCard tender={{ ...tender, closingAt: null, city: null, state: null }} />);
    expect(screen.getByText("Location not specified")).toBeInTheDocument();
    expect(screen.queryByText(/days? left|Closes today/)).toBeNull();
  });
});

describe("SaveTenderButton", () => {
  it("reflects saved state via aria-pressed and toggles on click", async () => {
    saved = false;
    const { rerender } = render(<SaveTenderButton tenderId="t1" />);
    const btn = screen.getByRole("button", { name: "Save tender" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(btn);
    expect(toggle).toHaveBeenCalledWith("t1");
    saved = true;
    rerender(<SaveTenderButton tenderId="t1" />);
    expect(screen.getByRole("button", { name: "Remove from saved tenders" })).toHaveAttribute("aria-pressed", "true");
  });
});
