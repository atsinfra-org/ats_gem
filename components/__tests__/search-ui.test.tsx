import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "@/components/search/search-box";
import { FilterPanel } from "@/components/search/filter-panel";
import { SearchHistoryDialog } from "@/components/search/search-history-dialog";
import { MatchReasonBadge } from "@/components/search/match-reason";
import { emptyFilters } from "@/lib/search/search-state";
import { ApiError } from "@/lib/api/client";

const suggest = vi.fn();
const history = vi.fn();
const del = vi.fn();
const clear = vi.fn();
const entities = vi.fn();
const cities = vi.fn();
const districts = vi.fn();

vi.mock("@/lib/api/search", () => ({
  getSuggestions: (...a: unknown[]) => suggest(...a),
  listHistory: (...a: unknown[]) => history(...a),
  deleteHistoryItem: (...a: unknown[]) => del(...a),
  clearHistory: (...a: unknown[]) => clear(...a),
  searchEntities: (...a: unknown[]) => entities(...a),
  searchCities: (...a: unknown[]) => cities(...a),
  recordSearchEvent: vi.fn(),
}));
vi.mock("@/lib/api/taxonomy", () => ({
  listStates: () => Promise.resolve([{ code: "MH", name: "Maharashtra", type: "STATE" }, { code: "UP", name: "Uttar Pradesh", type: "STATE" }]),
  listCategories: () =>
    Promise.resolve([
      { id: "c1", name: "Construction", slug: "construction", parentId: null, industry: null },
      { id: "c2", name: "Roads", slug: "roads", parentId: "c1", industry: null },
    ]),
  listTenderTypes: () => Promise.resolve([{ key: "OPEN", name: "Open Tender" }]),
  listSources: () => Promise.resolve([{ id: "s1", name: "Source One", slug: "one" }]),
  listDistricts: (...a: unknown[]) => districts(...a),
}));

vi.mock("@/lib/store/auth-dialog-store", () => ({ useAuthDialog: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }) }));

const noSuggestions = { recent: [], references: [], entities: [], categories: [], states: [], popular: [] };

beforeEach(() => {
  vi.clearAllMocks();
  history.mockResolvedValue([]);
  suggest.mockResolvedValue(noSuggestions);
  districts.mockResolvedValue([]);
  cities.mockResolvedValue([]);
});

describe("SearchBox (combobox)", () => {
  it("exposes the ARIA combobox contract and submits typed text", async () => {
    const onSubmit = vi.fn();
    render(<SearchBox value="" onSubmit={onSubmit} onPickFilter={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Search tenders" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await userEvent.type(input, "  road   works ");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("road works");
  });

  it("shows grouped suggestions, supports arrow keys with aria-activedescendant, and picks with Enter", async () => {
    suggest.mockResolvedValue({
      ...noSuggestions,
      recent: [{ id: "h1", query: "road repair" }],
      entities: [{ id: "e1", name: "Delhi Jal Board" }],
      states: [{ code: "DL", name: "Delhi" }],
    });
    const onSubmit = vi.fn();
    const onPick = vi.fn();
    render(<SearchBox value="" onSubmit={onSubmit} onPickFilter={onPick} />);
    const input = screen.getByRole("combobox", { name: "Search tenders" });
    await userEvent.type(input, "del");
    const list = await screen.findByRole("listbox", { name: "Search suggestions" });
    await waitFor(() => expect(input).toHaveAttribute("aria-expanded", "true"));
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    expect(within(list).getByRole("group", { name: "Organizations" })).toBeInTheDocument();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const active = input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(active)).toHaveTextContent("Delhi Jal Board");
    expect(document.getElementById(active)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("procuringEntity", "e1", "Delhi Jal Board");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("a recent-search suggestion re-runs that query", async () => {
    suggest.mockResolvedValue({ ...noSuggestions, recent: [{ id: "h1", query: "road repair" }] });
    const onSubmit = vi.fn();
    render(<SearchBox value="" onSubmit={onSubmit} onPickFilter={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "road");
    await userEvent.click(await screen.findByRole("option", { name: /road repair/ }));
    expect(onSubmit).toHaveBeenCalledWith("road repair");
  });

  it("Escape closes the popup without submitting", async () => {
    suggest.mockResolvedValue({ ...noSuggestions, states: [{ code: "DL", name: "Delhi" }] });
    const onSubmit = vi.fn();
    render(<SearchBox value="" onSubmit={onSubmit} onPickFilter={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "del");
    await screen.findByRole("option", { name: /Delhi/ });
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("lists the user's recent searches when focused with no text", async () => {
    history.mockResolvedValue([{ id: "h1", queryNormalized: "bridge repair", filters: {}, searchCount: 2, lastSearchedAt: new Date().toISOString() }]);
    render(<SearchBox value="" onSubmit={vi.fn()} onPickFilter={vi.fn()} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /bridge repair/ })).toBeInTheDocument();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("still lets the user search when the suggestion service fails", async () => {
    suggest.mockRejectedValue(new ApiError("DEPENDENCY_UNAVAILABLE", "down", 503));
    const onSubmit = vi.fn();
    render(<SearchBox value="" onSubmit={onSubmit} onPickFilter={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "road");
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    expect(screen.queryByRole("option")).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("road");
  });

  it("follows the committed query when the URL changes", () => {
    const { rerender } = render(<SearchBox value="a" onSubmit={vi.fn()} onPickFilter={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("a");
    rerender(<SearchBox value="b" onSubmit={vi.fn()} onPickFilter={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("b");
  });
});

describe("FilterPanel (advanced, multi-select)", () => {
  it("toggles multiple states and reports the list", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Maharashtra" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: ["MH"] }));
    rerender(<FilterPanel filters={{ ...emptyFilters, state: ["MH"] }} onChange={onChange} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Uttar Pradesh" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: ["MH", "UP"] }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Maharashtra" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: [] }));
  });

  it("shows the category hierarchy, tender types and sources from the API", async () => {
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Category" }));
    expect(await screen.findByRole("checkbox", { name: "Construction" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Roads" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tender Type" }));
    expect(await screen.findByRole("checkbox", { name: "Open Tender" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(await screen.findByRole("checkbox", { name: "Source One" })).toBeInTheDocument();
  });

  it("filters the state list as you type", async () => {
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "Maharashtra" });
    await userEvent.type(screen.getByLabelText("Find states"), "uttar");
    expect(screen.queryByRole("checkbox", { name: "Maharashtra" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Uttar Pradesh" })).toBeInTheDocument();
  });

  it("only accepts decimal input for money and flags an inverted range", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "EMD (₹)" }));
    await userEvent.type(await screen.findByLabelText("EMD minimum"), "1a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minEmd: "1" }));
    rerender(<FilterPanel filters={{ ...emptyFilters, minEmd: "500", maxEmd: "100" }} onChange={onChange} onClear={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Minimum is greater than maximum.");
    expect(screen.getByLabelText("EMD maximum")).toHaveAttribute("aria-invalid", "true");
  });

  it("flags an inverted date range and notes the IST semantics", async () => {
    render(<FilterPanel filters={{ ...emptyFilters, closingFrom: "2026-10-31", closingTo: "2026-10-01" }} onChange={vi.fn()} onClear={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The end date is before the start date.");
    expect(screen.getByText(/Indian Standard Time \(IST\)/)).toBeInTheDocument();
  });

  it("searches organizations on the server and selects one", async () => {
    entities.mockResolvedValue([{ id: "e1", name: "Delhi Jal Board", stateCode: "DL" }]);
    const onChange = vi.fn();
    const onLabel = vi.fn();
    render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} onEntityLabel={onLabel} />);
    await userEvent.click(screen.getByRole("button", { name: "Organization" }));
    await userEvent.type(await screen.findByLabelText("Search organizations"), "jal");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Delhi Jal Board" }));
    expect(onLabel).toHaveBeenCalledWith("e1", "Delhi Jal Board");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ procuringEntity: ["e1"] }));
  });

  it("compact mode offers only state, category and status", async () => {
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} compact />);
    expect(await screen.findByRole("checkbox", { name: "Maharashtra" })).toBeInTheDocument();
    for (const name of ["Organization", "Tender Type", "Source", "Dates", "EMD (₹)"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});

describe("SearchHistoryDialog", () => {
  const item = { id: "h1", queryNormalized: "road repair", filters: { state: ["MH"] }, searchCount: 3, lastSearchedAt: new Date().toISOString() };

  it("lists history with filters, re-runs an item and removes another", async () => {
    history.mockResolvedValue([item, { ...item, id: "h2", queryNormalized: "bridge", filters: {}, searchCount: 1 }]);
    del.mockResolvedValue(undefined);
    const onRun = vi.fn();
    render(<SearchHistoryDialog open onOpenChange={vi.fn()} onRun={onRun} />);
    expect(await screen.findByText("road repair")).toBeInTheDocument();
    expect(screen.getByText(/State: MH/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run search road repair" }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ q: "road repair", filters: expect.objectContaining({ state: ["MH"] }) }));

    await userEvent.click(screen.getByRole("button", { name: "Remove search bridge from history" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("h2"));
    await waitFor(() => expect(screen.queryByText("bridge")).toBeNull());
  });

  it("clears everything and shows the empty state", async () => {
    history.mockResolvedValue([item]);
    clear.mockResolvedValue(undefined);
    render(<SearchHistoryDialog open onOpenChange={vi.fn()} onRun={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear all history" }));
    expect(clear).toHaveBeenCalled();
    expect(await screen.findByText("No search history yet.")).toBeInTheDocument();
  });

  it("shows a retryable error when history cannot load", async () => {
    history.mockRejectedValueOnce(new ApiError("DEPENDENCY_UNAVAILABLE", "down", 503)).mockResolvedValue([]);
    render(<SearchHistoryDialog open onOpenChange={vi.fn()} onRun={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByText("No search history yet.")).toBeInTheDocument();
  });
});

describe("MatchReasonBadge", () => {
  it("renders the reason from the API with an accessible prefix, and nothing when absent", () => {
    const { container, rerender } = render(<MatchReasonBadge reason="REFERENCE_EXACT" />);
    expect(screen.getByText("Exact reference")).toBeInTheDocument();
    expect(screen.getByText("Matched because:", { exact: false })).toBeInTheDocument();
    rerender(<MatchReasonBadge reason={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MatchReasonBadge reason={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
