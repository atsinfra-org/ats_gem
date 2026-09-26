import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { SaveSearchModal } from "@/components/search/save-search-modal";
import { EditSavedSearchDialog } from "@/components/saved-searches/edit-saved-search-dialog";
import { LoginForm } from "@/components/auth/login-form";
import { emptyFilters } from "@/components/search/filter-panel";
import type { SavedSearch } from "@/lib/api/types";

const create = vi.fn();
const update = vi.fn();
const login = vi.fn();
vi.mock("@/lib/api/saved-searches", () => ({ createSavedSearch: (...a: unknown[]) => create(...a), updateSavedSearch: (...a: unknown[]) => update(...a) }));
vi.mock("@/lib/api/auth", () => ({ login: (...a: unknown[]) => login(...a) }));
vi.mock("@/lib/auth/session-context", () => ({ useSession: () => ({ refreshUser: vi.fn() }) }));
vi.mock("@/lib/api/taxonomy", () => ({
  listStates: () => Promise.resolve([{ code: "MH", name: "Maharashtra", type: "STATE" }]),
  listCategories: () => Promise.resolve([{ id: "c1", name: "Roads", slug: "roads", parentId: null, industry: null }]),
  listTenderTypes: () => Promise.resolve([]),
  listSources: () => Promise.resolve([]),
  listDistricts: () => Promise.resolve([]),
}));

beforeEach(() => vi.clearAllMocks());

describe("SaveSearchModal", () => {
  it("keeps Save disabled until a name is entered, then submits criteria", async () => {
    create.mockResolvedValue({});
    const onOpenChange = vi.fn();
    render(<SaveSearchModal open onOpenChange={onOpenChange} keyword="road" filters={{ ...emptyFilters, state: ["MH"] }} />);
    const save = screen.getByRole("button", { name: "Save Search" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Search Name"), "Roads MH");
    await userEvent.click(save);
    await waitFor(() => expect(create).toHaveBeenCalledWith("Roads MH", expect.objectContaining({ q: "road", state: ["MH"] }), "OFF"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows an error and stays open when the API fails", async () => {
    create.mockRejectedValue(new ApiError("INTERNAL_ERROR", "Server exploded", 500));
    const onOpenChange = vi.fn();
    render(<SaveSearchModal open onOpenChange={onOpenChange} keyword="" filters={emptyFilters} />);
    await userEvent.type(screen.getByLabelText("Search Name"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Save Search" }));
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

const existing: SavedSearch = { id: "s1", organizationId: "o", createdBy: "u", name: "Old name", criteria: { q: "bridge", state: "MH", closingFrom: "2026-10-01T00:00:00.000Z" }, alertFrequency: "OFF", createdAt: "", updatedAt: "" };

describe("EditSavedSearchDialog", () => {
  it("loads existing criteria, saves changes preserving date criteria, and reports the update", async () => {
    update.mockResolvedValue({ ...existing, name: "New name" });
    const onSaved = vi.fn();
    render(<EditSavedSearchDialog search={existing} onOpenChange={vi.fn()} onSaved={onSaved} />);
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Old name");
    expect(screen.getByLabelText("Keyword")).toHaveValue("bridge");
    await userEvent.clear(name);
    await userEvent.type(name, "New name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("s1", "New name", expect.objectContaining({ q: "bridge", state: ["MH"], closingFrom: "2026-10-01T00:00:00.000Z" })));
    expect(onSaved).toHaveBeenCalled();
  });

  it("validates a blank name without calling the API, and Cancel closes", async () => {
    const onOpenChange = vi.fn();
    render(<EditSavedSearchDialog search={existing} onOpenChange={onOpenChange} onSaved={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required.");
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces API errors", async () => {
    update.mockRejectedValue(new ApiError("VALIDATION_FAILED", "bad", 400, [{ message: "criteria invalid" }]));
    render(<EditSavedSearchDialog search={existing} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("criteria invalid")).toBeInTheDocument();
  });
});

describe("LoginForm", () => {
  it("validates required fields and shows field errors", async () => {
    render(<LoginForm onSuccess={vi.fn()} onForgotPassword={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(await screen.findByText("Email is required.")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("shows an alert for invalid credentials and calls onSuccess otherwise", async () => {
    login.mockRejectedValueOnce(new ApiError("INVALID_CREDENTIALS", "x", 401));
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} onForgotPassword={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Email Address"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass");
    await userEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    login.mockResolvedValueOnce({});
    await userEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("toggles password visibility with an accessible control", async () => {
    render(<LoginForm onSuccess={vi.fn()} onForgotPassword={vi.fn()} />);
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw).toHaveAttribute("type", "text");
  });
});
