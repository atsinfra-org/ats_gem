"use client";

import { AlertTriangle } from "lucide-react";

/** Last-resort boundary (root layout itself failed): no providers are available, so keep it dependency-free. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <div role="alert" className="flex flex-col items-center gap-3">
          <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
          <p className="text-3xl font-bold">500</p>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-sm text-sm">An unexpected error occurred on our end. Please try again in a moment.</p>
          <button onClick={reset} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
