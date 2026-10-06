import { describe, expect, it } from "vitest";
import { buildChips } from "./chips";
import { activeFilterCount, emptyFilters, emptySearch, fromCriteria, parseSearchParams, toApiParams, toCriteria, toSearchParams, toSearchUrl } from "./search-state";

const UUID = "0198c1a2-3b4c-7d5e-8f60-123456789abc";
const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs));

describe("parseSearchParams", () => {
  it("parses a full valid URL", () => {
    const { state, invalid } = parse(`q=road+works&state=MH,UP&category=${UUID}&status=OPEN&minValue=1000.50&closingFrom=2026-10-01&closingTo=2026-10-31&sort=closingSoonest&page=3`);
    expect(invalid).toEqual([]);
    expect(state).toMatchObject({ q: "road works", sort: "closingSoonest", page: 3 });
    expect(state.filters.state).toEqual(["MH", "UP"]);
    expect(state.filters.category).toEqual([UUID]);
    expect(state.filters.minValue).toBe("1000.50");
    expect(state.filters.closingTo).toBe("2026-10-31");
  });

  it("accepts repeated params as well as comma lists, and de-duplicates", () => {
    expect(parse("state=MH&state=UP,MH").state.filters.state).toEqual(["MH", "UP"]);
  });

  it("reads the legacy `keyword` param, with `q` taking precedence", () => {
    expect(parse("keyword=bridge").state.q).toBe("bridge");
    expect(parse("keyword=bridge&q=road").state.q).toBe("road");
  });

  it("drops and reports invalid values instead of passing them on", () => {
    const { state, invalid } = parse("state=maharashtra&category=nope&status=WRONG&minValue=abc&closingFrom=2026-13-45&sort=random&page=-2");
    expect(new Set(invalid)).toEqual(new Set(["state", "category", "status", "minValue", "closingFrom", "sort", "page"]));
    expect(toSearchParams(state).toString()).toBe("");
  });

  it("keeps the valid part of a partly-invalid list", () => {
    const { state, invalid } = parse("state=MH,zz9");
    expect(state.filters.state).toEqual(["MH"]);
    expect(invalid).toEqual(["state"]);
  });

  it("rejects inverted ranges by dropping the upper bound", () => {
    const money = parse("minValue=500&maxValue=100");
    expect(money.state.filters.maxValue).toBe("");
    expect(money.invalid).toContain("maxValue");
    const dates = parse("closingFrom=2026-10-31&closingTo=2026-10-01");
    expect(dates.state.filters.closingTo).toBe("");
  });

  it("rejects impossible calendar dates and over-long queries", () => {
    expect(parse("publishedFrom=2026-02-30").invalid).toContain("publishedFrom");
    const long = parse(`q=${"x".repeat(500)}`);
    expect(long.state.q).toHaveLength(200);
    expect(long.invalid).toContain("q");
  });

  it("treats hostile input as inert text", () => {
    const { state } = parse("q=%27%3B+DROP+TABLE+tenders%3B--&state=%3Cscript%3E");
    expect(state.q).toBe("'; DROP TABLE tenders;--");
    expect(state.filters.state).toEqual([]);
  });
});

describe("toSearchParams / toApiParams", () => {
  it("omits defaults so equal searches share one canonical URL", () => {
    expect(toSearchUrl(emptySearch)).toBe("/tenders");
    const a = parse("state=UP,MH&q=x&page=1&sort=relevance").state;
    expect(toSearchUrl(a)).toBe("/tenders?q=x&state=UP%2CMH");
  });

  it("round-trips through the parser", () => {
    const original = parse(`q=solar&state=MH&tenderType=OPEN&source=${UUID}&minEmd=10&maxEmd=99.5&openingFrom=2026-11-01&sort=valueHigh&page=2`).state;
    expect(parse(toSearchParams(original).toString()).state).toEqual(original);
  });

  it("builds API params with comma lists and omits empties", () => {
    const api = toApiParams(parse("q=road&state=MH,UP&minValue=5").state, 12);
    expect(api).toMatchObject({ q: "road", state: "MH,UP", minValue: "5", sort: "relevance", page: 1, pageSize: 12 });
    expect(api.category).toBeUndefined();
    expect(api.maxValue).toBeUndefined();
  });

  it("counts a range or list as one active filter", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(activeFilterCount(parse("state=MH,UP&minValue=1&maxValue=2&closingFrom=2026-10-01").state.filters)).toBe(3);
  });
});

describe("saved-search criteria", () => {
  it("serializes result-defining fields (not the page) and reads them back", () => {
    const s = parse(`q=road&state=MH,UP&category=${UUID}&closingFrom=2026-10-01&sort=newest&page=4`).state;
    const c = toCriteria(s);
    expect(c).toEqual({ q: "road", state: ["MH", "UP"], category: [UUID], closingFrom: "2026-10-01", sort: "newest" });
    expect(fromCriteria(c)).toEqual({ ...s, page: 1 });
  });

  it("reads legacy single-string criteria (Phase 3-6 saved searches)", () => {
    const s = fromCriteria({ q: "bridge", state: "MH", category: UUID, status: "OPEN", closingFrom: "2026-10-01T00:00:00.000Z" });
    expect(s.q).toBe("bridge");
    expect(s.filters.state).toEqual(["MH"]);
    expect(s.filters.status).toEqual(["OPEN"]);
    expect(s.filters.category).toEqual([UUID]);
    expect(s.filters.closingFrom).toBe("2026-10-01");
  });

  it("ignores unknown or invalid stored values rather than throwing", () => {
    const s = fromCriteria({ state: ["ZZZ", "MH"], minValue: "lots", unknown: "x" });
    expect(s.filters.state).toEqual(["MH"]);
    expect(s.filters.minValue).toBe("");
  });
});

describe("buildChips", () => {
  it("creates one removable chip per value and per range", () => {
    const s = parse("q=road&state=MH,UP&status=OPEN&minValue=1000&maxValue=5000&closingFrom=2026-10-01").state;
    const chips = buildChips(s, { state: { MH: "Maharashtra" } });
    expect(chips.map((c) => c.label)).toEqual(["Keyword: road", "State: Maharashtra", "State: UP", "Status: Open", "Value: ₹1,000 – ₹5,000", "Closing: from 1 Oct 2026"]);
  });

  it("removing a chip clears only that filter and resets the page", () => {
    const s = { ...parse("q=road&state=MH,UP&minValue=1&maxValue=2").state, page: 5 };
    const chips = buildChips(s);
    const afterState = chips.find((c) => c.id === "state:MH")!.remove(s);
    expect(afterState.filters.state).toEqual(["UP"]);
    expect(afterState.page).toBe(1);
    const afterRange = chips.find((c) => c.id === "minValue:maxValue")!.remove(s);
    expect(afterRange.filters.minValue).toBe("");
    expect(afterRange.filters.maxValue).toBe("");
    expect(afterRange.q).toBe("road");
  });
});
