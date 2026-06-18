"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
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
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

  const data = useQuery(api.hq.overview, isHq && token ? { token } : "skip");

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
                sub={`${totals!.today_orders} orders · all outlets`}
              />
              <StatCard
                label="Active Orders"
                value={totals!.active_orders}
                icon={<ShoppingBag className="h-5 w-5" />}
                sub="In progress (all outlets)"
              />
              <StatCard
                label="Tables Occupied"
                value={`${totals!.occupied_tables} / ${totals!.total_tables}`}
                icon={<UtensilsCrossed className="h-5 w-5" />}
                sub="Across outlets"
              />
              <StatCard
                label="Low Stock Alerts"
                value={totals!.low_stock_count}
                icon={<AlertTriangle className="h-5 w-5" />}
                sub="Items below threshold"
                warn={totals!.low_stock_count > 0}
              />
            </div>

            {/* Combined revenue chart */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-medium text-sm">Company Revenue (Last 14 Days)</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  Total paid: {formatCurrency(totals!.total_revenue)}
                </span>
              </div>
              {data.revenueByDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={data.revenueByDay}>
                    <defs>
                      <linearGradient id="hqRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "6px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#hqRevenue)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                  No revenue data yet
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
