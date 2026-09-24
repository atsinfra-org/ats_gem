"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <AlertTriangle className="h-14 w-14 text-destructive" />
        <h1 className="mt-6 text-4xl font-bold text-foreground">500</h1>
        <p className="mt-2 text-lg font-semibold text-foreground">Something went wrong</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred on our end. Please try again in a moment.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try Again
        </Button>
      </body>
    </html>
  );
}
