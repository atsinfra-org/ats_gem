"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { tenderOpportunityTrend } from "@/lib/mock/analytics";

export function TenderOpportunityChart() {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={tenderOpportunityTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="opportunityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EF233C" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#EF233C" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Area type="monotone" dataKey="opportunities" stroke="#EF233C" strokeWidth={2.5} fill="url(#opportunityFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
