import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicNavbar } from "@/components/layout/public-navbar";
import { AuthDialogProvider, useAuthDialog } from "@/lib/store/auth-dialog-store";

const push = vi.fn();
const logout = vi.fn(() => Promise.resolve());
let session: { user: unknown; isAuthenticated: boolean; sessionExpired: boolean; logout: typeof logout };

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));
vi.mock("@/lib/auth/session-context", () => ({ useSession: () => session }));

const signedOut = () => ({ user: null, isAuthenticated: false, sessionExpired: false, logout });
const signedIn = () => ({ user: { id: "u1" }, isAuthenticated: true, sessionExpired: false, logout });

function DialogState() {
  const { isOpen, open } = useAuthDialog();
  return (
    <>
      <p data-testid="dialog">{isOpen ? "open" : "closed"}</p>
      <button type="button" onClick={open}>
        Create free account
      </button>
    </>
  );
}

function renderNavbar() {
  return render(
    <AuthDialogProvider>
      <PublicNavbar />
      <DialogState />
    </AuthDialogProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  session = signedOut();
});

describe("PublicNavbar", () => {
  it("offers Login and Get Started to signed-out visitors, opening the auth dialog", async () => {
    renderNavbar();
    expect(screen.getByRole("button", { name: "Login" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Get Started" }));
    expect(screen.getByTestId("dialog")).toHaveTextContent("open");
    expect(push).not.toHaveBeenCalled();
  });

  it("offers Dashboard and Log out once signed in", async () => {
    session = signedIn();
    renderNavbar();
    expect(screen.queryByRole("button", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get Started" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("keeps the auth buttons hidden until the session check settles", () => {
    session = { ...signedOut(), user: undefined };
    renderNavbar();
    expect(screen.getByRole("button", { name: "Login" })).toHaveClass("invisible");
    expect(screen.getByRole("button", { name: "Get Started" })).toHaveClass("invisible");
  });

  it("treats an expired session as signed out", async () => {
    session = { ...signedIn(), sessionExpired: true };
    renderNavbar();
    await userEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(screen.getByTestId("dialog")).toHaveTextContent("open");
  });
});

describe("AuthDialogProvider", () => {
  it("sends a signed-in user to the dashboard instead of opening the login form", async () => {
    session = signedIn();
    renderNavbar();
    await userEvent.click(screen.getByRole("button", { name: "Create free account" }));
    expect(push).toHaveBeenCalledWith("/dashboard");
    expect(screen.getByTestId("dialog")).toHaveTextContent("closed");
  });
});
