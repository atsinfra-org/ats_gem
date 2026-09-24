"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { adminUserGrowth, adminTenderIngestion, adminRevenue, adminSourceBreakdown } from "@/lib/mock/analytics";

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 13,
};

export function UserGrowthChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={adminUserGrowth} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="userGrowthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="users" stroke="#2563EB" strokeWidth={2.5} fill="url(#userGrowthFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TenderIngestionChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={adminTenderIngestion} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="day" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="ingested" fill="#EF233C" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={adminRevenue} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16A34A" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="var(--color-text-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`₹${Number(v).toLocaleString("en-IN")}`, "Revenue"]} />
        <Area type="monotone" dataKey="revenue" stroke="#16A34A" strokeWidth={2.5} fill="url(#revenueFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SourceBreakdownChart() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={adminSourceBreakdown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} strokeWidth={0}>
          {adminSourceBreakdown.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-muted-foreground">{v}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}
