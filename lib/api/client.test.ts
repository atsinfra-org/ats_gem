import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, setAccessToken } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
  setAccessToken(null);
});

describe("apiRequest", () => {
  it("unwraps the success envelope and sends the bearer token", async () => {
    setAccessToken("tok");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { success: true, data: { a: 1 }, meta: {} }));
    await expect(apiRequest("/x")).resolves.toEqual({ a: 1 });
    expect((spy.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("throws a typed ApiError from the error envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(409, { success: false, error: { code: "EMAIL_ALREADY_REGISTERED", message: "exists" } }));
    await expect(apiRequest("/auth/register", { method: "POST", body: {} })).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED", status: 409 });
  });

  it("refreshes once on 401 and retries the request", async () => {
    setAccessToken("old");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(401, { success: false, error: { code: "TOKEN_EXPIRED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { accessToken: "new", expiresIn: 900 } }))
      .mockResolvedValueOnce(json(200, { success: true, data: "ok", meta: {} }));
    await expect(apiRequest("/me")).resolves.toBe("ok");
    expect(spy).toHaveBeenCalledTimes(3);
    expect((spy.mock.calls[2][1]?.headers as Record<string, string>).Authorization).toBe("Bearer new");
  });

  it("maps network failure to NETWORK_ERROR", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fail"));
    await expect(apiRequest("/x", { anonymous: true })).rejects.toBeInstanceOf(ApiError);
  });
});
