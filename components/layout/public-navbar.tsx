"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session-context";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

const navLinks = [
  { href: "/tenders", label: "Tenders" },
  { href: "/solutions", label: "Solutions" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About Us" },
];

export function PublicNavbar() {
  const pathname = usePathname();
  const onDark = pathname === "/";
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { open: openAuth } = useAuthDialog();
  const { user, isAuthenticated, sessionExpired, logout } = useSession();
  const signedIn = isAuthenticated && !sessionExpired;
  // Until the session check settles the buttons keep their space but stay hidden, so a signed-in
  // visitor never sees "Login" flash and the bar doesn't shift.
  const pending = user === undefined;

  function signOut() {
    logout().catch(() => toast.error("Could not log out. Please try again."));
  }

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 w-full border-b transition-colors duration-300",
        onDark
          ? scrolled
            ? "border-white/10 bg-ink/85 backdrop-blur"
            : "border-transparent bg-transparent"
          : "border-border bg-card/95 shadow-sm backdrop-blur"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className={cn("text-xl font-bold tracking-tight", onDark ? "text-white" : "text-foreground")}>
            ATS <span className="text-primary">Gem</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === link.href
                  ? "text-primary"
                  : onDark
                    ? "text-white/70 hover:bg-white/10 hover:text-white"
                    : "text-foreground/80 hover:bg-secondary hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button
            variant="ghost"
            size="icon"
            asChild
            className={cn(onDark && "text-white hover:bg-white/10 hover:text-white")}
          >
            <Link href="/tenders" aria-label="Search tenders">
              <Search className="h-4.5 w-4.5" />
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={signedIn ? signOut : openAuth}
            className={cn(
              onDark && "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white",
              pending && "invisible"
            )}
          >
            {signedIn ? "Log out" : "Login"}
          </Button>
          {signedIn ? (
            <Button asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button onClick={openAuth} className={cn(pending && "invisible")}>
              Get Started
            </Button>
          )}
        </div>

        <button
          className={cn(
            "inline-flex items-center justify-center rounded-md p-2 lg:hidden",
            onDark ? "text-white" : "text-foreground"
          )}
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="flex flex-col">
          <SheetHeader>
            <SheetTitle>
              ATS <span className="text-primary">Gem</span>
            </SheetTitle>
          </SheetHeader>
          <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <SheetClose asChild key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
                >
                  {link.label}
                </Link>
              </SheetClose>
            ))}
          </nav>
          <div className={cn("mt-auto flex flex-col gap-2 border-t border-border pt-4", pending && "invisible")}>
            <Button
              variant="outline"
              onClick={() => {
                setMobileOpen(false);
                if (signedIn) signOut();
                else openAuth();
              }}
            >
              {signedIn ? "Log out" : "Login"}
            </Button>
            {signedIn ? (
              <SheetClose asChild>
                <Button asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              </SheetClose>
            ) : (
              <Button
                onClick={() => {
                  setMobileOpen(false);
                  openAuth();
                }}
              >
                Get Started
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
