"use client";

import * as React from "react";
import { Search, MoreVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TenderStatusBadge } from "@/components/tender/tender-status-badge";
import { tenders } from "@/lib/mock/tenders";
import { format } from "date-fns";

export default function AdminTendersPage() {
  const [query, setQuery] = React.useState("");
  const filtered = tenders.filter((t) => !query || `${t.title} ${t.tenderId} ${t.department}`.toLowerCase().includes(query.toLowerCase())).slice(0, 25);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Tenders</h2>
        <p className="text-sm text-muted-foreground">{tenders.length.toLocaleString("en-IN")} tenders indexed</p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenders..." className="pl-9" />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Tender ID</th>
              <th className="px-5 py-3 font-medium">Title</th>
              <th className="px-5 py-3 font-medium">Organization</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Closing</th>
              <th className="px-5 py-3 font-medium">Source</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{t.tenderId}</td>
                <td className="px-5 py-3 max-w-xs truncate font-medium text-foreground">{t.title}</td>
                <td className="px-5 py-3 max-w-[160px] truncate text-muted-foreground">{t.organization}</td>
                <td className="px-5 py-3 text-muted-foreground">{t.category}</td>
                <td className="px-5 py-3 text-muted-foreground">{t.location}</td>
                <td className="px-5 py-3"><TenderStatusBadge status={t.status} /></td>
                <td className="px-5 py-3 text-muted-foreground">{format(new Date(t.submissionDeadline), "dd MMM yyyy")}</td>
                <td className="px-5 py-3 text-muted-foreground">{t.source}</td>
                <td className="px-5 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Tender actions"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>View</DropdownMenuItem>
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Archive</DropdownMenuItem>
                      <DropdownMenuItem destructive>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
