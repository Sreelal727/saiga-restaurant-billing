"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import {
  TrendingUp,
  ShoppingBag,
  UtensilsCrossed,
  AlertTriangle,
  IndianRupee,
  Clock,
  ChefHat,
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
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types & constants ────────────────────────────────────────────────────────

type ActiveStatus = "pending" | "confirmed" | "preparing" | "ready" | "served";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ready: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  served: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const TABLE_STATUS_STYLE: Record<string, string> = {
  available: "border-green-300 bg-green-50 dark:bg-green-950/20",
  occupied: "border-orange-400 bg-orange-50 dark:bg-orange-950/20",
  reserved: "border-blue-300 bg-blue-50 dark:bg-blue-950/20",
};

const NEXT_STATUS: Partial<Record<ActiveStatus, ActiveStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "served",
};

function formatElapsed(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const stats = useQuery(api.dashboard.stats);
  const recentOrders = useQuery(api.dashboard.recentOrders);
  const revenue = useQuery(api.dashboard.revenueByDay);
  const liveTables = useQuery(api.dashboard.liveTables);
  const activeOrders = useQuery(api.dashboard.activeOrders);
  const updateStatus = useMutation(api.orders.updateStatus);

  async function handleAdvance(
    id: Id<"restaurant_orders">,
    status: ActiveStatus
  ): Promise<void> {
    const next = NEXT_STATUS[status];
    if (!next) return;
    try {
      await updateStatus({ id, status: next });
    } catch {
      toast.error("Failed to update order");
    }
  }

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
            sub={stats ? `${stats.today_orders} orders today` : "Today"}
          />
          <StatCard
            label="Active Orders"
            value={stats?.active_orders ?? "—"}
            icon={<ShoppingBag className="h-5 w-5" />}
            sub="In progress"
          />
          <StatCard
            label="Tables Occupied"
            value={stats ? `${stats.occupied_tables} / ${stats.total_tables}` : "—"}
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

        {/* Floor map */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium text-sm">Floor Map</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded bg-green-400 inline-block" /> Available
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded bg-orange-400 inline-block" /> Occupied
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded bg-blue-400 inline-block" /> Reserved
              </span>
            </div>
          </div>
          {liveTables === undefined ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
              Loading tables…
            </div>
          ) : liveTables.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
              No tables configured
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
              {liveTables.map((table) => (
                <div
                  key={table._id}
                  className={cn(
                    "border-2 rounded-lg p-2 text-center text-xs transition-colors",
                    TABLE_STATUS_STYLE[table.status] ??
                      "border-border bg-card"
                  )}
                >
                  <p className="font-bold">{table.table_number}</p>
                  <p className="text-muted-foreground">{table.capacity}p</p>
                  {table.current_order && (
                    <Link
                      href={`/orders/${table.current_order._id}`}
                      className="block text-primary hover:underline mt-0.5 truncate"
                      title={table.current_order.order_number}
                    >
                      {table.current_order.order_number}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Two-column: chart + live orders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

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

          {/* Live active orders feed */}
          <div className="bg-card border border-border rounded-lg flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium text-sm">Live Orders Feed</h2>
              {activeOrders !== undefined && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {activeOrders.length} active
                </span>
              )}
            </div>
            {activeOrders === undefined ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
            ) : activeOrders.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No active orders
              </div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "260px" }}>
                {activeOrders.map((order) => {
                  const next = NEXT_STATUS[order.status as ActiveStatus];
                  return (
                    <div key={order._id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/orders/${order._id}`}
                            className="font-medium text-sm hover:text-primary transition-colors"
                          >
                            {order.order_number}
                          </Link>
                          {order.table && (
                            <span className="text-xs text-muted-foreground">
                              T{order.table.table_number}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatElapsed(order._creationTime)}
                          {order.waiter ? ` · ${order.waiter.name}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0",
                          STATUS_COLORS[order.status] ?? ""
                        )}
                      >
                        {order.status}
                      </span>
                      {next && (
                        <button
                          onClick={() =>
                            handleAdvance(order._id, order.status as ActiveStatus)
                          }
                          className="text-xs text-primary hover:underline shrink-0"
                        >
                          → {next}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent orders */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-medium text-sm">Recent Orders</h2>
            <Link href="/orders" className="text-xs text-primary hover:underline">
              View all
            </Link>
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
                      <Link
                        href={`/orders/${order._id}`}
                        className="font-medium text-sm hover:text-primary transition-colors"
                      >
                        {order.order_number}
                      </Link>
                      {order.table && (
                        <span className="text-xs text-muted-foreground">
                          {order.table.table_number}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                      {order.waiter ? ` · ${order.waiter.name}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-medium",
                      STATUS_COLORS[order.status] ?? ""
                    )}
                  >
                    {order.status}
                  </span>
                  <span className="text-sm font-medium tabular-nums shrink-0">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Kitchen shortcut */}
        <a
          href="/kitchen"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg hover:bg-secondary/40 transition-colors group"
        >
          <ChefHat className="h-6 w-6 text-primary" />
          <div>
            <p className="font-medium text-sm">Open Kitchen Display System</p>
            <p className="text-xs text-muted-foreground">
              Full-screen KDS for the kitchen — opens in a new tab
            </p>
          </div>
          <span className="ml-auto text-muted-foreground group-hover:text-foreground text-xs">
            ↗
          </span>
        </a>

      </div>
    </div>
  );
}
