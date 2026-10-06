import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatusError, errorKind } from "@/components/states/status-error";
import { ApiError } from "@/lib/api/client";

const open = vi.fn();
vi.mock("@/lib/store/auth-dialog-store", () => ({ useAuthDialog: () => ({ open, close: vi.fn(), isOpen: false }) }));

describe("errorKind", () => {
  it.each([
    [new ApiError("UNAUTHENTICATED", "x", 401), 401],
    [new ApiError("FORBIDDEN", "x", 403), 403],
    [new ApiError("TIMEOUT", "x", 0), 408],
    [new ApiError("RATE_LIMITED", "x", 429), 429],
    [new ApiError("DEPENDENCY_UNAVAILABLE", "x", 503), 503],
    [new ApiError("NETWORK_ERROR", "x", 0), "network"],
    [new ApiError("INTERNAL_ERROR", "boom", 500), 500],
    [new Error("random"), 500],
  ])("maps %o to %s", (err, kind) => expect(errorKind(err)).toBe(kind));
});

describe("StatusError", () => {
  it.each([
    [401, "Please log in"],
    [403, "Access denied"],
    [408, "Request timed out"],
    [429, "Too many requests"],
    [500, "Something went wrong"],
    [503, "Service unavailable"],
  ] as const)("renders a distinct view for %s", (kind, title) => {
    render(<StatusError kind={kind} />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-error-kind", String(kind));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  it("offers retry for retryable errors and calls back", async () => {
    const onRetry = vi.fn();
    render(<StatusError kind={503} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers login (not retry) for 401", async () => {
    render(<StatusError kind={401} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(open).toHaveBeenCalled();
  });

  it("does not offer retry for 403", () => {
    render(<StatusError kind={403} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
