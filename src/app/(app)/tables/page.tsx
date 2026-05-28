"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Plus, Users, ChevronRight, X, UtensilsCrossed, UserCheck } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

type TableStatus = "available" | "occupied" | "reserved";

type TableWithOrder = {
  _id: Id<"restaurant_tables">;
  table_number: string;
  capacity: number;
  status: TableStatus;
  current_order_id?: Id<"restaurant_orders">;
  currentOrder: {
    _id: Id<"restaurant_orders">;
    order_number: string;
    status: string;
    total: number;
    customer_name: string | null;
    item_count: number;
  } | null;
};

const STATUS_CARD: Record<TableStatus, string> = {
  available: "border-green-400 bg-green-50 dark:bg-green-950/20",
  occupied:  "border-primary bg-primary/5",
  reserved:  "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20",
};

const STATUS_DOT: Record<TableStatus, string> = {
  available: "bg-green-500",
  occupied:  "bg-primary",
  reserved:  "bg-yellow-500",
};

const STATUS_LABEL: Record<TableStatus, string> = {
  available: "Available",
  occupied:  "Occupied",
  reserved:  "Reserved",
};

const ORDER_STATUS_COLOR: Record<string, string> = {
  pending:   "text-yellow-600 dark:text-yellow-400",
  confirmed: "text-blue-600 dark:text-blue-400",
  preparing: "text-orange-600 dark:text-orange-400",
  ready:     "text-purple-600 dark:text-purple-400",
  served:    "text-green-600 dark:text-green-400",
};

export default function TablesPage() {
  const router = useRouter();
  const tables = useQuery(api.tables.listWithCurrentOrder) as TableWithOrder[] | undefined;
  const staff = useQuery(api.staff.list, { active_only: true });
  const upcoming = useQuery(api.reservations.listNextPerTable, {});
  const createTable = useMutation(api.tables.create);
  const updateStatus = useMutation(api.tables.updateStatus);

  // Map table_id → next upcoming reservation for the in-card badge
  const nextResByTable = new Map<
    Id<"restaurant_tables">,
    { customer_name: string; scheduled_at: number; party_size: number }
  >();
  for (const r of upcoming ?? []) {
    nextResByTable.set(r.table_id, {
      customer_name: r.customer_name,
      scheduled_at: r.scheduled_at,
      party_size: r.party_size,
    });
  }

  const [selected, setSelected] = useState<TableWithOrder | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [capacity, setCapacity] = useState("4");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tableNumber.trim()) return;
    try {
      await createTable({ table_number: tableNumber.trim(), capacity: Number(capacity) });
      toast.success("Table added");
      setTableNumber("");
      setCapacity("4");
      setShowAdd(false);
    } catch {
      toast.error("Failed to add table");
    }
  }

  async function handleStatusChange(table: TableWithOrder, next: TableStatus) {
    if (table.status === "occupied") {
      toast.error("Cannot change status of an occupied table. Close the order first.");
      return;
    }
    try {
      await updateStatus({ id: table._id, status: next });
      setSelected((prev) => (prev?._id === table._id ? { ...prev, status: next } : prev));
    } catch {
      toast.error("Failed to update status");
    }
  }

  function handleNewOrder(table: TableWithOrder, waiterId?: string) {
    const params = new URLSearchParams({ table: table._id });
    if (waiterId) params.set("waiter", waiterId);
    router.push(`/orders/new?${params.toString()}`);
  }

  const counts = {
    available: tables?.filter((t) => t.status === "available").length ?? 0,
    occupied:  tables?.filter((t) => t.status === "occupied").length ?? 0,
    reserved:  tables?.filter((t) => t.status === "reserved").length ?? 0,
  };

  const addBtn = (
    <button
      onClick={() => setShowAdd(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Table
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <Header title="Tables" action={addBtn} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Summary pills */}
          {tables && tables.length > 0 && (
            <div className="flex gap-3 mb-5">
              <Pill color="green" label="Available" count={counts.available} />
              <Pill color="blue"  label="Occupied"  count={counts.occupied} />
              <Pill color="yellow" label="Reserved" count={counts.reserved} />
            </div>
          )}

          {/* Add table form */}
          {showAdd && (
            <form
              onSubmit={handleCreate}
              className="mb-6 bg-card border border-border rounded-lg p-4 max-w-sm"
            >
              <h3 className="font-medium text-sm mb-3">New Table</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Table Number / Name</label>
                  <input
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder="e.g. T7 or VIP-1"
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Capacity</label>
                  <input
                    type="number"
                    min={1}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdd(false)}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          {tables === undefined ? (
            <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
          ) : tables.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-20">
              No tables configured. Add your first table.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {tables.map((table) => (
                <TableCard
                  key={table._id}
                  table={table}
                  isSelected={selected?._id === table._id}
                  nextReservation={nextResByTable.get(table._id)}
                  onClick={() => setSelected(selected?._id === table._id ? null : table)}
                  onNewOrder={() => handleNewOrder(table)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Side panel */}
        {selected && (
          <TablePanel
            table={selected}
            staff={staff?.filter((s) => s.role === "waiter") ?? []}
            onClose={() => setSelected(null)}
            onStatusChange={handleStatusChange}
            onNewOrder={handleNewOrder}
          />
        )}
      </div>
    </div>
  );
}

// ─── Table Card ───────────────────────────────────────────────────────────────

function TableCard({
  table,
  isSelected,
  nextReservation,
  onClick,
  onNewOrder,
}: {
  table: TableWithOrder;
  isSelected: boolean;
  nextReservation?: { customer_name: string; scheduled_at: number; party_size: number };
  onClick: () => void;
  onNewOrder: () => void; // card quick-link — no waiter pre-selection
}) {
  return (
    <div
      className={cn(
        "border-2 rounded-xl p-4 cursor-pointer select-none transition-all hover:shadow-md",
        STATUS_CARD[table.status],
        isSelected && "ring-2 ring-primary ring-offset-2"
      )}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <span className="font-semibold text-lg leading-none">{table.table_number}</span>
        <span className={cn("h-2.5 w-2.5 rounded-full mt-0.5 shrink-0", STATUS_DOT[table.status])} />
      </div>

      {/* Capacity */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
        <Users className="h-3 w-3" />
        <span>{table.capacity} seats</span>
      </div>

      {/* Status / order info */}
      {table.status === "occupied" && table.currentOrder ? (
        <div className="mt-2 space-y-0.5">
          <p className="text-xs font-medium truncate">{table.currentOrder.order_number}</p>
          {table.currentOrder.customer_name && (
            <p className="text-xs text-muted-foreground truncate">{table.currentOrder.customer_name}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {table.currentOrder.item_count} item{table.currentOrder.item_count !== 1 ? "s" : ""}
          </p>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(table.currentOrder.total)}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{STATUS_LABEL[table.status]}</p>
      )}

      {/* Next reservation badge */}
      {nextReservation && table.status !== "occupied" && (
        <div className="mt-2 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 text-xs">
          <p className="font-medium text-blue-800 dark:text-blue-300">
            Reserved {new Date(nextReservation.scheduled_at).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="text-blue-700/80 dark:text-blue-400/80 truncate">
            {nextReservation.customer_name} · party of {nextReservation.party_size}
          </p>
        </div>
      )}

      {/* Quick action hint */}
      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        {table.status === "occupied" ? (
          <Link
            href={`/orders/${table.currentOrder?._id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 text-primary hover:underline"
          >
            Open Order <ChevronRight className="h-3 w-3" />
          </Link>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onNewOrder(); }}
            className="flex items-center gap-0.5 text-primary hover:underline"
          >
            <UtensilsCrossed className="h-3 w-3" /> New Order
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Side Panel ───────────────────────────────────────────────────────────────

interface StaffMember {
  _id: Id<"restaurant_staff">;
  name: string;
  role: string;
}

function TablePanel({
  table,
  staff,
  onClose,
  onStatusChange,
  onNewOrder,
}: {
  table: TableWithOrder;
  staff: StaffMember[];
  onClose: () => void;
  onStatusChange: (table: TableWithOrder, next: TableStatus) => void;
  onNewOrder: (table: TableWithOrder, waiterId?: string) => void;
}) {
  const [selectedWaiterId, setSelectedWaiterId] = useState("");
  const order = table.currentOrder;

  return (
    <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-semibold">{table.table_number}</p>
          <p className="text-xs text-muted-foreground">{table.capacity} seats</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* Status badge */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Status</p>
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[table.status])} />
            <span className="text-sm font-medium">{STATUS_LABEL[table.status]}</span>
          </div>
        </div>

        {/* Status controls (only for non-occupied) */}
        {table.status !== "occupied" && (
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Change Status</p>
            <div className="flex gap-2">
              <button
                onClick={() => onStatusChange(table, "available")}
                disabled={table.status === "available"}
                className={cn(
                  "flex-1 py-1.5 text-xs rounded-md transition-colors",
                  table.status === "available"
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 cursor-default font-medium"
                    : "bg-secondary text-secondary-foreground hover:bg-green-100 hover:text-green-800 dark:hover:bg-green-900/30 dark:hover:text-green-300"
                )}
              >
                Available
              </button>
              <button
                onClick={() => onStatusChange(table, "reserved")}
                disabled={table.status === "reserved"}
                className={cn(
                  "flex-1 py-1.5 text-xs rounded-md transition-colors",
                  table.status === "reserved"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 cursor-default font-medium"
                    : "bg-secondary text-secondary-foreground hover:bg-yellow-100 hover:text-yellow-800 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-300"
                )}
              >
                Reserved
              </button>
            </div>
          </div>
        )}

        {/* Occupied — active order details */}
        {table.status === "occupied" && order && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Order</p>

            <div className="bg-background rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{order.order_number}</span>
                <span className={cn("text-xs capitalize", ORDER_STATUS_COLOR[order.status] ?? "text-muted-foreground")}>
                  {order.status}
                </span>
              </div>
              {order.customer_name && (
                <p className="text-xs text-muted-foreground">{order.customer_name}</p>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">
                  {order.item_count} item{order.item_count !== 1 ? "s" : ""}
                </span>
                <span className="font-semibold tabular-nums">{formatCurrency(order.total)}</span>
              </div>
            </div>

            <Link
              href={`/orders/${order._id}`}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Open Order <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Available / reserved — waiter + new order CTA */}
        {table.status !== "occupied" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Actions</p>

            {/* Waiter selection */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                <UserCheck className="h-3.5 w-3.5" />
                Assign Waiter
              </label>
              <select
                value={selectedWaiterId}
                onChange={(e) => setSelectedWaiterId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— No waiter —</option>
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => onNewOrder(table, selectedWaiterId || undefined)}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <UtensilsCrossed className="h-4 w-4" />
              Start New Order
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Summary pill ─────────────────────────────────────────────────────────────

function Pill({ color, label, count }: { color: "green" | "blue" | "yellow"; label: string; count: number }) {
  const styles = {
    green:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    blue:   "bg-primary/10 text-primary",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium", styles[color])}>
      <span className="font-bold">{count}</span> {label}
    </span>
  );
}
