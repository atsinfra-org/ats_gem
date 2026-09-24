import type { Metadata } from "next";
import { Poppins, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AppStoreProvider } from "@/lib/store/app-store";
import { AuthDialogProvider } from "@/lib/store/auth-dialog-store";
import { AuthDialog } from "@/components/auth/auth-dialog";
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

export const metadata: Metadata = {
  title: {
    default: "ATS Gem — Find. Track. Win. Tenders.",
    template: "%s | ATS Gem",
  },
  description:
    "ATS Gem is a tender intelligence platform that helps Indian businesses discover, track and win government and private tenders with real-time alerts and verified data.",
  metadataBase: new URL("https://atsgem.example.com"),
  openGraph: {
    title: "ATS Gem — Find. Track. Win. Tenders.",
    description:
      "Discover, track and win government and private tenders with real-time alerts and verified data.",
    siteName: "ATS Gem",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ATS Gem — Find. Track. Win. Tenders.",
    description:
      "Discover, track and win government and private tenders with real-time alerts and verified data.",
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
          <AppStoreProvider>
            <AuthDialogProvider>
              {children}
              <AuthDialog />
              <Toaster richColors position="top-right" closeButton />
            </AuthDialogProvider>
          </AppStoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
