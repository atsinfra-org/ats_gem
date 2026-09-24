import { AlertTriangle, WifiOff, ShieldAlert, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorMessage({
  title = "Something went wrong",
  description = "An unexpected error occurred. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-14 px-6 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-2">
          Try Again
        </Button>
      )}
    </div>
  );
}

export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-14 px-6 text-center">
      <WifiOff className="h-8 w-8 text-muted-foreground" />
      <h3 className="text-base font-semibold text-foreground">You&apos;re offline</h3>
      <p className="max-w-sm text-sm text-muted-foreground">Check your internet connection and try again.</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-2">
          Retry
        </Button>
      )}
    </div>
  );
}

export function PermissionDenied() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-14 px-6 text-center">
      <ShieldAlert className="h-8 w-8 text-destructive" />
      <h3 className="text-base font-semibold text-foreground">Access denied</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        You don&apos;t have permission to view this page. Contact your administrator if you believe this is a mistake.
      </p>
    </div>
  );
}

export function NotFoundInline({ label = "item" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-14 px-6 text-center">
      <FileQuestion className="h-8 w-8 text-muted-foreground" />
      <h3 className="text-base font-semibold text-foreground">{`No ${label} found`}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        The {label} you&apos;re looking for doesn&apos;t exist or may have been removed.
      </p>
    </div>
  );
}
