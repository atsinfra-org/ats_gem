import type { Metadata } from "next";
import { Suspense } from "react";
import { TenderSearchView } from "./tender-search-view";
import { SkeletonTender } from "@/components/states/skeletons";

export const metadata: Metadata = { title: "Tender Search" };

export default function TenderSearchPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonTender key={i} />
          ))}
        </div>
      }
    >
      <TenderSearchView />
    </Suspense>
  );
}
