import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <FileQuestion className="h-14 w-14 text-muted-foreground" />
      <h1 className="mt-6 text-4xl font-bold text-foreground">404</h1>
      <p className="mt-2 text-lg font-semibold text-foreground">Page not found</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="outline" asChild>
          <Link href="/">Go Home</Link>
        </Button>
        <Button asChild>
          <Link href="/tenders">Browse Tenders</Link>
        </Button>
      </div>
    </div>
  );
}
