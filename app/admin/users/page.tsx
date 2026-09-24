"use client";

import * as React from "react";
import { Search, MoreVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { adminUsers } from "@/lib/mock/users";
import { format } from "date-fns";

const statusVariant = { active: "success", suspended: "danger", invited: "warning" } as const;

export default function AdminUsersPage() {
  const [query, setQuery] = React.useState("");
  const [plan, setPlan] = React.useState("all");
  const [status, setStatus] = React.useState("all");

  const filtered = adminUsers.filter((u) => {
    if (query && !`${u.name} ${u.email} ${u.company}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (plan !== "all" && u.plan !== plan) return false;
    if (status !== "all" && u.status !== status) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground">{adminUsers.length} total registered users</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or company..." className="pl-9" />
        </div>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plans</SelectItem>
            <SelectItem value="Free">Free</SelectItem>
            <SelectItem value="Professional">Professional</SelectItem>
            <SelectItem value="Business">Business</SelectItem>
            <SelectItem value="Enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="invited">Invited</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="hidden overflow-x-auto p-0 sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Company</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Joined</th>
              <th className="px-5 py-3 font-medium">Last Active</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-medium text-foreground">{u.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.company}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.plan}</td>
                <td className="px-5 py-3"><Badge variant={statusVariant[u.status]} className="capitalize">{u.status}</Badge></td>
                <td className="px-5 py-3 text-muted-foreground">{format(new Date(u.joined), "dd MMM yyyy")}</td>
                <td className="px-5 py-3 text-muted-foreground">{format(new Date(u.lastActive), "dd MMM yyyy")}</td>
                <td className="px-5 py-3 text-right">
                  <UserActions />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="space-y-3 sm:hidden">
        {filtered.map((u) => (
          <Card key={u.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Badge variant={statusVariant[u.status]} className="capitalize">{u.status}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{u.company}</span>
              <span>Plan: {u.plan}</span>
              <span>Joined {format(new Date(u.joined), "dd MMM yyyy")}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UserActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User actions"><MoreVertical className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>View Details</DropdownMenuItem>
        <DropdownMenuItem>Edit User</DropdownMenuItem>
        <DropdownMenuItem destructive>Suspend User</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
