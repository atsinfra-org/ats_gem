import { Search, BellRing, FileCheck2 } from "lucide-react";

export function AuthIllustration() {
  return (
    <div className="relative flex h-48 items-center justify-center">
      <div className="absolute h-40 w-40 rounded-full bg-primary/10" />
      <div className="absolute h-24 w-24 -translate-x-16 translate-y-10 rounded-full bg-[var(--color-info)]/10" />

      <div className="relative w-56 rounded-xl border border-border bg-card p-3 shadow-lg">
        <div className="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="h-2 w-24 rounded-full bg-border" />
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="h-2 w-full rounded-full bg-secondary" />
          <div className="h-2 w-3/4 rounded-full bg-secondary" />
        </div>
      </div>

      <div className="absolute -right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
        <BellRing className="h-5 w-5" />
      </div>
      <div className="absolute -left-3 bottom-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-success)] text-white shadow-md">
        <FileCheck2 className="h-4.5 w-4.5" />
      </div>
    </div>
  );
}
