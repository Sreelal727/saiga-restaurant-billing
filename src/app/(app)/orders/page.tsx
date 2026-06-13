"use client";

import { useState } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "paid"
  | "cancelled";

const STATUSES = [
  "all",
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "paid",
  "cancelled",
] as const;

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ready: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  served: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

// "served" excluded — payment must go through the detail page
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "served",
};

const PAGE_SIZE = 25;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [search, setSearch] = useState("");

  const isSearching = search.trim().length > 0;
  const resolvedStatus = filter === "all" ? undefined : filter;

  // Search mode: bounded scan with JS filter
  const searchResults = useQuery(
    api.orders.list,
    isSearching
      ? { search: search.trim(), status: resolvedStatus, limit: 200 }
      : "skip"
  );

  // Browse mode: cursor-based pagination
  const {
    results: paginatedResults,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.orders.listPaginated,
    { status: resolvedStatus },
    { initialNumItems: PAGE_SIZE }
  );

  const updateStatus = useMutation(api.orders.updateStatus);

  async function handleAdvance(
    id: Id<"restaurant_orders">,
    status: OrderStatus
  ): Promise<void> {
    const next = NEXT_STATUS[status];
    if (!next) return;
    try {
      await updateStatus({ id, status: next });
    } catch {
      toast.error("Failed to update order status");
    }
  }

  const displayOrders = isSearching ? (searchResults ?? []) : paginatedResults;
  const isLoading = isSearching
    ? searchResults === undefined
    : paginationStatus === "LoadingFirstPage";

  const newOrderBtn = (
    <Link
      href="/orders/new"
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" />
      New Order
    </Link>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Orders" action={newOrderBtn} />

      <div className="flex-1 p-6">
        {/* Quick actions */}
        <QuickActionsPanel variant="compact" className="mb-4" />

        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order # or customer name…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap capitalize transition-colors",
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : displayOrders.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            {isSearching ? `No orders matching "${search}"` : "No orders found"}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {displayOrders.map((order) => {
                const next = NEXT_STATUS[order.status as OrderStatus];
                return (
                  <div
                    key={order._id}
                    className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/orders/${order._id}`}
                          className="font-semibold text-sm hover:text-primary transition-colors"
                        >
                          {order.order_number}
                        </Link>
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                            STATUS_STYLE[order.status as OrderStatus]
                          )}
                        >
                          {order.status}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize bg-secondary px-2 py-0.5 rounded">
                          {order.order_type.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.table ? `Table ${order.table.table_number} · ` : ""}
                        {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                        {order.waiter ? ` · ${order.waiter.name}` : ""}
                        {order.customer_name ? ` · ${order.customer_name}` : ""}
                        {order._creationTime
                          ? ` · ${formatDateTime(order._creationTime)}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCurrency(order.total)}
                      </p>
                      {order.status === "served" ? (
                        <Link
                          href={`/orders/${order._id}`}
                          className="mt-1 text-xs text-primary hover:underline block"
                        >
                          → Pay
                        </Link>
                      ) : next ? (
                        <button
                          onClick={() =>
                            handleAdvance(order._id, order.status as OrderStatus)
                          }
                          className="mt-1 text-xs text-primary hover:underline"
                        >
                          → {next}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more (only in browse mode) */}
            {!isSearching && paginationStatus === "CanLoadMore" && (
              <div className="mt-6 text-center">
                <button
                  onClick={() => loadMore(PAGE_SIZE)}
                  className="px-6 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/70 transition-colors"
                >
                  Load more orders
                </button>
              </div>
            )}

            {/* Search result count */}
            {isSearching && searchResults !== undefined && (
              <p className="mt-4 text-xs text-center text-muted-foreground">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
