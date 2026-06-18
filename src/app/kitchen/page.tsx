"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { ChefHat, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTenant } from "@/components/outlet/outlet-context";

/**
 * The KDS is a long-lived screen — without a tick the elapsed time on each
 * ticket would freeze at first render. This drives a re-render every 30s so
 * every visible "5m" / "12m" / "1h 4m" advances correctly while staff are
 * working through the queue.
 */
function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

type KdsStatus = "confirmed" | "preparing" | "ready";

interface ColumnConfig {
  status: KdsStatus;
  label: string;
  nextStatus: "preparing" | "ready" | "served";
  nextLabel: string;
  headerBg: string;
  cardBorder: string;
  cardBg: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    status: "confirmed",
    label: "New Orders",
    nextStatus: "preparing",
    nextLabel: "Start Cooking",
    headerBg: "bg-blue-600",
    cardBorder: "border-blue-400",
    cardBg: "bg-blue-50 dark:bg-blue-950/20",
  },
  {
    status: "preparing",
    label: "Preparing",
    nextStatus: "ready",
    nextLabel: "Mark Ready",
    headerBg: "bg-orange-500",
    cardBorder: "border-orange-400",
    cardBg: "bg-orange-50 dark:bg-orange-950/20",
  },
  {
    status: "ready",
    label: "Ready to Serve",
    nextStatus: "served",
    nextLabel: "Mark Served",
    headerBg: "bg-green-600",
    cardBorder: "border-green-400",
    cardBg: "bg-green-50 dark:bg-green-950/20",
  },
];

function formatElapsed(creationTime: number): string {
  const mins = Math.floor((Date.now() - creationTime) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface KdsOrder {
  _id: Id<"restaurant_orders">;
  _creationTime: number;
  order_number: string;
  order_type: string;
  status: string;
  notes?: string;
  table: { table_number: string } | null;
  items: {
    _id: Id<"order_items">;
    name: string;
    variant_label?: string;
    quantity: number;
    notes?: string;
  }[];
}

interface OrderCardProps {
  order: KdsOrder;
  col: ColumnConfig;
  onAdvance: (id: Id<"restaurant_orders">, status: KdsStatus) => Promise<void>;
}

function OrderCard({ order, col, onAdvance }: OrderCardProps) {
  const mins = Math.floor((Date.now() - order._creationTime) / 60_000);
  const isAged = mins >= 15;

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 flex flex-col gap-3",
        col.cardBorder,
        col.cardBg,
        isAged && "ring-2 ring-red-500 ring-offset-1"
      )}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-base leading-tight">{order.order_number}</p>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">
            {order.order_type.replace("_", " ")}
            {order.table ? ` · Table ${order.table.table_number}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-semibold shrink-0",
            isAged ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          {formatElapsed(order._creationTime)}
          {isAged && " ⚠"}
        </span>
      </div>

      {/* Items */}
      <ul className="space-y-1.5 flex-1">
        {order.items.map((item) => (
          <li key={item._id} className="flex items-start justify-between gap-2 text-sm">
            <span className="flex-1 font-medium">
              {item.name}
              {item.variant_label && (
                <span className="ml-1 font-normal text-muted-foreground">
                  ({item.variant_label})
                </span>
              )}
            </span>
            {item.notes && (
              <span className="text-xs text-muted-foreground italic">
                ({item.notes})
              </span>
            )}
            <span className="font-bold tabular-nums shrink-0">×{item.quantity}</span>
          </li>
        ))}
      </ul>

      {/* Order notes */}
      {order.notes && (
        <p className="text-xs italic text-muted-foreground border-t border-border/50 pt-2">
          📝 {order.notes}
        </p>
      )}

      {/* Advance button */}
      <button
        onClick={() => onAdvance(order._id, col.status)}
        className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors mt-1"
      >
        {col.nextLabel}
      </button>
    </div>
  );
}

export default function KitchenPage() {
  const tenant = useTenant();
  const confirmed = useQuery(
    api.orders.list,
    tenant.args ? { ...tenant.args, status: "confirmed", limit: 50 } : "skip"
  );
  const preparing = useQuery(
    api.orders.list,
    tenant.args ? { ...tenant.args, status: "preparing", limit: 50 } : "skip"
  );
  const ready = useQuery(
    api.orders.list,
    tenant.args ? { ...tenant.args, status: "ready", limit: 50 } : "skip"
  );
  const updateStatus = useMutation(api.orders.updateStatus);
  // Tick once every 30s so the per-card "elapsed" display advances even when
  // no Convex query update arrives.
  useTick(30_000);

  const isLoading =
    confirmed === undefined || preparing === undefined || ready === undefined;

  async function handleAdvance(
    id: Id<"restaurant_orders">,
    current: KdsStatus
  ): Promise<void> {
    const col = COLUMNS.find((c) => c.status === current);
    if (!col) return;
    if (!tenant.args) return;
    try {
      await updateStatus({ ...tenant.args, id, status: col.nextStatus });
      toast.success(`Moved to ${col.nextStatus}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update order");
    }
  }

  const byStatus: Record<KdsStatus, KdsOrder[]> = {
    confirmed: (confirmed ?? []) as KdsOrder[],
    preparing: (preparing ?? []) as KdsOrder[],
    ready: (ready ?? []) as KdsOrder[],
  };

  const totalActive =
    (confirmed?.length ?? 0) + (preparing?.length ?? 0) + (ready?.length ?? 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-6 py-3 bg-card border-b border-border shrink-0">
        <ChefHat className="h-6 w-6 text-primary" />
        <h1 className="text-base font-bold">Kitchen Display System</h1>
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {totalActive} active order{totalActive !== 1 ? "s" : ""}
          </span>
        )}
        <a
          href="/dashboard"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs hover:bg-secondary/70 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Dashboard
        </a>
      </header>

      {/* Columns */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading kitchen orders…
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-3 gap-0 overflow-hidden">
          {COLUMNS.map((col) => {
            const orders = byStatus[col.status];
            return (
              <div key={col.status} className="flex flex-col border-r last:border-r-0 border-border overflow-hidden">
                {/* Column header */}
                <div
                  className={cn(
                    "flex items-center justify-between px-4 py-2.5 shrink-0",
                    col.headerBg
                  )}
                >
                  <span className="text-white font-semibold text-sm">{col.label}</span>
                  <span className="text-white/80 text-xs font-medium bg-white/20 px-2 py-0.5 rounded-full">
                    {orders.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {orders.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">
                      No orders
                    </div>
                  ) : (
                    orders.map((order) => (
                      <OrderCard
                        key={order._id}
                        order={order as KdsOrder}
                        col={col}
                        onAdvance={handleAdvance}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
