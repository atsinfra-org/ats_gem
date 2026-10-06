import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

function freshImport() {
  vi.resetModules();
  return import("./client");
}

describe("track()", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("batches events and flushes them as one request after the debounce window", async () => {
    const { track } = await freshImport();
    track("PAGE_VIEW", { path: "/tenders" });
    track("PROFILE_VIEWED");
    expect(global.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/analytics/events");
    const body = JSON.parse((init as RequestInit).body as string) as { events: { name: string; anonymousId: string; occurredAt: string }[] };
    expect(body.events).toHaveLength(2);
    expect(body.events[0].name).toBe("PAGE_VIEW");
    expect(body.events.every((e) => typeof e.anonymousId === "string" && e.anonymousId.length >= 8)).toBe(true);
    expect(body.events.every((e) => !Number.isNaN(new Date(e.occurredAt).getTime()))).toBe(true);
  });

  it("flushes immediately once a batch reaches its cap, without waiting for the debounce", async () => {
    const { track } = await freshImport();
    for (let i = 0; i < 20; i++) track("PAGE_VIEW", { path: `/p${i}` });
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses the same anonymousId across calls (stable per browser)", async () => {
    const { track } = await freshImport();
    track("PAGE_VIEW", { path: "/a" });
    await vi.advanceTimersByTimeAsync(350);
    track("PAGE_VIEW", { path: "/b" });
    await vi.advanceTimersByTimeAsync(350);
    const bodies = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { events: { anonymousId: string }[] }).events[0].anonymousId);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("never throws when the network call fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const { track } = await freshImport();
    expect(() => track("PAGE_VIEW", { path: "/x" })).not.toThrow();
    await vi.advanceTimersByTimeAsync(350);
    await Promise.resolve();
  });

  it("attaches first-touch UTM/referrer attribution only to the first event of the page load", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://app.example.test/?utm_source=google&utm_medium=cpc"), writable: true });
    Object.defineProperty(document, "referrer", { value: "https://google.com/search", configurable: true });
    const { track } = await freshImport();
    track("PAGE_VIEW", { path: "/" });
    track("PROFILE_VIEWED");
    await vi.advanceTimersByTimeAsync(350);
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string) as { events: Record<string, unknown>[] };
    expect(body.events[0].utmSource).toBe("google");
    expect(body.events[0].referrerHost).toBe("google.com");
    expect(body.events[1].utmSource).toBeUndefined();
  });

  it("does nothing on the server (no window)", async () => {
    const { track } = await freshImport();
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating an SSR environment
    delete globalThis.window;
    expect(() => track("PAGE_VIEW")).not.toThrow();
    globalThis.window = originalWindow;
  });
});

describe("getAnonymousId", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists across calls via localStorage", async () => {
    vi.resetModules();
    const { getAnonymousId } = await import("./anonymous-id");
    const a = getAnonymousId();
    const b = getAnonymousId();
    expect(a).toBe(b);
    expect(window.localStorage.getItem("ats_anon_id")).toBe(a);
  });

  it("falls back to an in-memory id when storage throws", async () => {
    vi.resetModules();
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { getAnonymousId } = await import("./anonymous-id");
    expect(() => getAnonymousId()).not.toThrow();
    expect(getAnonymousId()).toBe(getAnonymousId());
    spy.mockRestore();
  });
});

describe("getAttribution", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("parses utm_* params and the referrer host from the current page", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://app.example.test/tenders?utm_source=news&utm_campaign=launch"), writable: true });
    Object.defineProperty(document, "referrer", { value: "https://partner.example/page", configurable: true });
    vi.resetModules();
    const { getAttribution } = await import("./attribution");
    const a = getAttribution();
    expect(a).toMatchObject({ utmSource: "news", utmCampaign: "launch", referrerHost: "partner.example", landingPath: "/tenders" });
  });

  it("caches the first capture in sessionStorage so a later navigation keeps the original landing page", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://app.example.test/first"), writable: true });
    vi.resetModules();
    const mod = await import("./attribution");
    const first = mod.getAttribution();
    Object.defineProperty(window, "location", { value: new URL("https://app.example.test/second"), writable: true });
    const second = mod.getAttribution();
    expect(second).toEqual(first);
    expect(second.landingPath).toBe("/first");
  });

  it("tolerates a malformed referrer instead of throwing", async () => {
    Object.defineProperty(window, "location", { value: new URL("https://app.example.test/"), writable: true });
    Object.defineProperty(document, "referrer", { value: "not a url", configurable: true });
    vi.resetModules();
    const { getAttribution } = await import("./attribution");
    expect(() => getAttribution()).not.toThrow();
    expect(getAttribution().referrerHost).toBeUndefined();
  });
});
