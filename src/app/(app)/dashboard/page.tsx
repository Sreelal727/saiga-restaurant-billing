"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import {
  TrendingUp,
  ShoppingBag,
  UtensilsCrossed,
  AlertTriangle,
  IndianRupee,
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

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ready: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  served: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function DashboardPage() {
  const stats = useQuery(api.dashboard.stats);
  const recentOrders = useQuery(api.dashboard.recentOrders);
  const revenue = useQuery(api.dashboard.revenueByDay);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Dashboard" />
      <div className="flex-1 p-6 space-y-6">

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's Revenue"
            value={stats ? formatCurrency(stats.today_revenue) : "—"}
            icon={<IndianRupee className="h-5 w-5" />}
            sub="Today"
          />
          <StatCard
            label="Active Orders"
            value={stats?.active_orders ?? "—"}
            icon={<ShoppingBag className="h-5 w-5" />}
            sub="In progress"
          />
          <StatCard
            label="Tables Occupied"
            value={
              stats
                ? `${stats.occupied_tables} / ${stats.total_tables}`
                : "—"
            }
            icon={<UtensilsCrossed className="h-5 w-5" />}
            sub="Right now"
          />
          <StatCard
            label="Low Stock Alerts"
            value={stats?.low_stock_count ?? "—"}
            icon={<AlertTriangle className="h-5 w-5" />}
            sub="Items below threshold"
            warn={!!stats && stats.low_stock_count > 0}
          />
        </div>

        {/* Revenue chart */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium text-sm">Revenue (Last 14 Days)</h2>
          </div>
          {revenue && revenue.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenue}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
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
                  fill="url(#revenueGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No revenue data yet
            </div>
          )}
        </div>

        {/* Recent orders */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-medium text-sm">Recent Orders</h2>
          </div>
          {recentOrders === undefined ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : recentOrders.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No orders yet</div>
          ) : (
            <div className="divide-y divide-border">
              {recentOrders.map((order) => (
                <div key={order._id} className="flex items-center gap-4 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{order.order_number}</span>
                      {order.table && (
                        <span className="text-xs text-muted-foreground">
                          {order.table.table_number}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {order.items.length} items
                      {order.waiter ? ` · ${order.waiter.name}` : ""}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? ""}`}
                  >
                    {order.status}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  warn?: boolean;
}

function StatCard({ label, value, icon, sub, warn }: StatCardProps) {
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
