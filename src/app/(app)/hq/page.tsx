"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import { useSession } from "@/components/auth/session-context";
import { useOutlet } from "@/components/outlet/outlet-context";
import { useRouter } from "next/navigation";
import {
  IndianRupee,
  ShoppingBag,
  UtensilsCrossed,
  AlertTriangle,
  TrendingUp,
  Building2,
  ChevronRight,
  Clock,
  Trophy,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
} as const;

function hour12(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base} ${period}`;
}

function StatCard({
  label,
  value,
  icon,
  sub,
  warn,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
        <span className={warn ? "text-destructive" : "text-primary"}>{icon}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

export default function HqDashboardPage() {
  const { session, token } = useSession();
  const { setSelectedOutletId } = useOutlet();
  const router = useRouter();
  const isHq = !!session?.is_hq;

  // Insight scope: "all" outlets or a specific outlet id.
  const [filter, setFilter] = useState<"all" | Id<"outlets">>("all");
  const outletsList = useQuery(
    api.outlets.listForHq,
    isHq && token ? { token } : "skip"
  );
  const data = useQuery(
    api.hq.overview,
    isHq && token
      ? { token, outletId: filter === "all" ? undefined : filter }
      : "skip"
  );
  const scopeName =
    filter === "all"
      ? "all outlets"
      : outletsList?.find((o) => o._id === filter)?.name ?? "outlet";

  if (!isHq) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <Header title="All Outlets" />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          This page is only available to the super admin.
        </div>
      </div>
    );
  }

  const totals = data?.totals;

  function openOutlet(outletId: string) {
    setSelectedOutletId(outletId as Parameters<typeof setSelectedOutletId>[0]);
    router.push("/dashboard");
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="All Outlets" />
      <div className="flex-1 p-6 space-y-6">
        {/* Insight scope filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Insights for</span>
          <select
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value === "all" ? "all" : (e.target.value as Id<"outlets">))
            }
            className="px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All outlets</option>
            {outletsList?.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        {data === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : (
          <>
            {/* Company-wide totals */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Today's Revenue"
                value={formatCurrency(totals!.today_revenue)}
                icon={<IndianRupee className="h-5 w-5" />}
                sub={`${totals!.today_orders} orders · ${scopeName}`}
              />
              <StatCard
                label="Active Orders"
                value={totals!.active_orders}
                icon={<ShoppingBag className="h-5 w-5" />}
                sub={`In progress · ${scopeName}`}
              />
              <StatCard
                label="Tables Occupied"
                value={`${totals!.occupied_tables} / ${totals!.total_tables}`}
                icon={<UtensilsCrossed className="h-5 w-5" />}
                sub={scopeName}
              />
              <StatCard
                label="Low Stock Alerts"
                value={totals!.low_stock_count}
                icon={<AlertTriangle className="h-5 w-5" />}
                sub="Items below threshold"
                warn={totals!.low_stock_count > 0}
              />
            </div>

            {/* Revenue (last 4 days) + Sales by hour */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Last 4 days — vertical bars */}
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-medium text-sm">Revenue — Last 4 Days</h2>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Total paid: {formatCurrency(totals!.total_revenue)}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.revenueLast4Days}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      cursor={{ fill: "var(--color-secondary)", opacity: 0.3 }}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Bar dataKey="revenue" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Sales by hour — peak highlighted */}
              <div className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-medium text-sm">Sales by Hour</h2>
                  <span className="ml-auto text-xs font-medium text-primary">
                    {data.peakHour ? `Peak: ${data.peakHour.label}` : "—"}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.hourly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      interval={0}
                      tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(h: number) => (h % 3 === 0 ? String(h) : "")}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      labelFormatter={(h: number) => hour12(h)}
                      cursor={{ fill: "var(--color-secondary)", opacity: 0.3 }}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {data.hourly.map((h) => (
                        <Cell
                          key={h.hour}
                          fill="var(--color-primary)"
                          fillOpacity={h.hour === data.peakHour?.hour ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  Last {data.windowDays} days · {scopeName}
                </p>
              </div>
            </div>

            {/* Top products by income */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Trophy className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-medium text-sm">Top Products by Income</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  Last {data.windowDays} days · {scopeName}
                </span>
              </div>
              {data.topProducts.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  No sales in this period yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-border">
                        <th className="text-left font-medium px-4 py-2 w-10">#</th>
                        <th className="text-left font-medium px-4 py-2">Product</th>
                        <th className="text-right font-medium px-4 py-2">Qty sold</th>
                        <th className="text-right font-medium px-4 py-2">Income ₹</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.topProducts.map((p, i) => (
                        <tr key={p.name} className="hover:bg-secondary/30">
                          <td className="px-4 py-2.5">
                            <span
                              className={
                                "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                                (i === 0
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                  : "bg-secondary text-secondary-foreground")
                              }
                            >
                              {i + 1}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-medium">{p.name}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{p.qty}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                            {formatCurrency(p.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Per-outlet breakdown */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-medium text-sm">Per-Outlet Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left font-medium px-4 py-2">Outlet</th>
                      <th className="text-right font-medium px-4 py-2">Today ₹</th>
                      <th className="text-right font-medium px-4 py-2">Orders</th>
                      <th className="text-right font-medium px-4 py-2">Active</th>
                      <th className="text-right font-medium px-4 py-2">Tables</th>
                      <th className="text-right font-medium px-4 py-2">Low stock</th>
                      <th className="text-right font-medium px-4 py-2">Total ₹</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.outlets.map((o) => (
                      <tr key={o.outlet_id} className="hover:bg-secondary/30">
                        <td className="px-4 py-2.5 font-medium">{o.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCurrency(o.today_revenue)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.today_orders}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.active_orders}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {o.occupied_tables}/{o.total_tables}
                        </td>
                        <td
                          className={
                            "px-4 py-2.5 text-right tabular-nums " +
                            (o.low_stock_count > 0 ? "text-destructive font-medium" : "")
                          }
                        >
                          {o.low_stock_count}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatCurrency(o.total_revenue)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => openOutlet(o.outlet_id)}
                            className="inline-flex items-center gap-0.5 text-primary hover:underline text-xs"
                          >
                            Open <ChevronRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
