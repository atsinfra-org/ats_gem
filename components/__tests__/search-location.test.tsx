import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterPanel } from "@/components/search/filter-panel";
import { buildChips } from "@/lib/search/chips";
import { activeFilterCount, emptyFilters, fromCriteria, parseSearchParams, toApiParams, toCriteria, toSearchParams } from "@/lib/search/search-state";

const cities = vi.fn();
const districts = vi.fn();
const D1 = "0198c1a2-3b4c-7d5e-8f60-123456789001";
const D2 = "0198c1a2-3b4c-7d5e-8f60-123456789002";

vi.mock("@/lib/api/search", () => ({
  searchCities: (...a: unknown[]) => cities(...a),
  searchEntities: vi.fn().mockResolvedValue([]),
  recordSearchEvent: vi.fn(),
}));
vi.mock("@/lib/api/taxonomy", () => ({
  listStates: () => Promise.resolve([{ code: "MH", name: "Maharashtra", type: "STATE" }, { code: "UP", name: "Uttar Pradesh", type: "STATE" }]),
  listCategories: () => Promise.resolve([]),
  listTenderTypes: () => Promise.resolve([]),
  listSources: () => Promise.resolve([]),
  listDistricts: (...a: unknown[]) => districts(...a),
}));

const dists = [
  { id: D1, name: "Pune", stateCode: "MH" },
  { id: D2, name: "Lucknow", stateCode: "UP" },
];

beforeEach(() => {
  vi.clearAllMocks();
  districts.mockResolvedValue(dists);
  cities.mockResolvedValue([]);
});

const open = (name: string) => userEvent.click(screen.getByRole("button", { name }));

describe("District filter", () => {
  it("lists real districts (with state) and reports selection", async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    await open("District");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Pune (MH)" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ district: [D1] }));
  });

  it("narrows to the selected state and drops the state suffix", async () => {
    render(<FilterPanel filters={{ ...emptyFilters, state: ["UP"] }} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("District");
    expect(await screen.findByRole("checkbox", { name: "Lucknow" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Pune/ })).toBeNull();
  });

  it("explains an empty district list instead of showing a broken control", async () => {
    districts.mockResolvedValue([]);
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("District");
    expect(await screen.findByText("No district data is available from the current sources.")).toBeInTheDocument();
  });

  it("shows an error when districts cannot be loaded, and still renders the other filters", async () => {
    districts.mockRejectedValue(new Error("down"));
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("District");
    expect(await screen.findByText("Districts could not be loaded.")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Maharashtra" })).toBeInTheDocument();
  });

  it("shows a loading state before the lists arrive", async () => {
    districts.mockReturnValue(new Promise(() => undefined));
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("District");
    expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
  });
});

describe("City filter (server-side lookup)", () => {
  it("searches the server after 2 characters, shows counts, and selects a city", async () => {
    cities.mockResolvedValue([{ name: "Pune", count: 12 }, { name: "Punjab Town", count: 1 }]);
    const onChange = vi.fn();
    render(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    await open("City");
    const box = await screen.findByLabelText("Search cities");
    await userEvent.type(box, "p");
    expect(cities).not.toHaveBeenCalled();
    await userEvent.type(box, "un");
    const opt = await screen.findByRole("checkbox", { name: /Pune/ });
    expect(screen.getByText("(12)")).toBeInTheDocument();
    await userEvent.click(opt);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ city: ["Pune"] }));
    expect(cities).toHaveBeenLastCalledWith("pun", undefined, expect.anything());
  });

  it("scopes the lookup to a single selected state", async () => {
    render(<FilterPanel filters={{ ...emptyFilters, state: ["MH"] }} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("City");
    await userEvent.type(await screen.findByLabelText("Search cities"), "pu");
    await waitFor(() => expect(cities).toHaveBeenCalledWith("pu", ["MH"], expect.anything()));
  });

  it("keeps selected cities visible, allows removal, and shows empty and error states", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterPanel filters={{ ...emptyFilters, city: ["Pune"] }} onChange={onChange} onClear={vi.fn()} />);
    await open("City");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Pune" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ city: [] }));

    rerender(<FilterPanel filters={emptyFilters} onChange={onChange} onClear={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Search cities"), "zz");
    expect(await screen.findByText("No cities found.")).toBeInTheDocument();

    cities.mockRejectedValue(new Error("down"));
    await userEvent.type(screen.getByLabelText("Search cities"), "z");
    expect(await screen.findByText("City search is unavailable right now.")).toBeInTheDocument();
  });

  it("shows a searching state while the request is in flight", async () => {
    cities.mockReturnValue(new Promise(() => undefined));
    render(<FilterPanel filters={emptyFilters} onChange={vi.fn()} onClear={vi.fn()} />);
    await open("City");
    await userEvent.type(await screen.findByLabelText("Search cities"), "pu");
    expect(await screen.findByText("Searching...")).toBeInTheDocument();
  });
});

describe("district & city in the search state", () => {
  it("round-trips through the URL, API params, saved criteria and chips", () => {
    const { state, invalid } = parseSearchParams(new URLSearchParams(`district=${D1},${D2}&city=Pune,Navi%20Mumbai&state=MH`));
    expect(invalid).toEqual([]);
    expect(state.filters.district).toEqual([D1, D2]);
    expect(state.filters.city).toEqual(["Pune", "Navi Mumbai"]);
    expect(parseSearchParams(toSearchParams(state)).state).toEqual(state);
    expect(toApiParams(state, 12)).toMatchObject({ district: `${D1},${D2}`, city: "Pune,Navi Mumbai" });
    expect(toCriteria(state)).toMatchObject({ district: [D1, D2], city: ["Pune", "Navi Mumbai"] });
    expect(fromCriteria(toCriteria(state)).filters.city).toEqual(["Pune", "Navi Mumbai"]);
    expect(activeFilterCount(state.filters)).toBe(3);

    const chips = buildChips(state, { district: { [D1]: "Pune" } });
    expect(chips.map((c) => c.label)).toEqual(expect.arrayContaining(["District: Pune", "District: District", "City: Pune", "City: Navi Mumbai"]));
    const afterRemove = chips.find((c) => c.id === "city:Pune")!.remove(state);
    expect(afterRemove.filters.city).toEqual(["Navi Mumbai"]);
  });

  it("drops invalid district ids and over-long cities, and caps the city list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`).join(",");
    const { state, invalid } = parseSearchParams(new URLSearchParams(`district=nope,${D1}&city=${"x".repeat(101)},Pune,${many}`));
    expect(state.filters.district).toEqual([D1]);
    expect(state.filters.city).toHaveLength(20);
    expect(state.filters.city[0]).toBe("Pune");
    expect(invalid).toEqual(expect.arrayContaining(["district", "city"]));
  });
});
