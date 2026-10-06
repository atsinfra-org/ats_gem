import type { Metadata } from "next";
import { Suspense } from "react";
import { Poppins, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { RouteTracker } from "@/components/analytics/route-tracker";
import { ErrorTracker } from "@/components/analytics/error-tracker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthDialogProvider } from "@/lib/store/auth-dialog-store";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { SessionProvider } from "@/lib/auth/session-context";
import { WatchlistProvider } from "@/lib/store/watchlist-store";
import { NotificationsProvider } from "@/lib/store/notifications-store";
import { SessionExpiredWatcher } from "@/components/auth/session-expired-watcher";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const DESCRIPTION = "ATS GeM is a tender discovery platform that helps Indian businesses find, track and organize government and private tenders.";

export const metadata: Metadata = {
  title: {
    default: "ATS GeM — Find. Track. Win. Tenders.",
    template: "%s | ATS GeM",
  },
  description: DESCRIPTION,
  metadataBase: new URL("https://atsgem.example.com"),
  openGraph: {
    title: "ATS GeM — Find. Track. Win. Tenders.",
    description: DESCRIPTION,
    siteName: "ATS GeM",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATS GeM — Find. Track. Win. Tenders.",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${instrumentSerif.variable} ${plexMono.variable} h-full`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col antialiased bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <SessionProvider>
            <WatchlistProvider>
              <NotificationsProvider>
                <AuthDialogProvider>
                  {children}
                  <AuthDialog />
                  <SessionExpiredWatcher />
                  <Suspense fallback={null}>
                    <RouteTracker />
                  </Suspense>
                  <ErrorTracker />
                  <Toaster richColors position="top-right" closeButton />
                </AuthDialogProvider>
              </NotificationsProvider>
            </WatchlistProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
