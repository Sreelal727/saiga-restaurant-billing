"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import QRCode from "qrcode";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, getErrorMessage } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Plus,
  Users,
  ChevronRight,
  X,
  UtensilsCrossed,
  UserCheck,
  QrCode,
  RefreshCcw,
  Printer,
  BellRing,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";
import { useSession } from "@/components/auth/session-context";
import { useTenant } from "@/components/outlet/outlet-context";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions";

type TableStatus = "available" | "occupied" | "reserved";

type TableWithOrder = {
  _id: Id<"restaurant_tables">;
  table_number: string;
  capacity: number;
  status: TableStatus;
  current_order_id?: Id<"restaurant_orders">;
  qr_token?: string;
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

type TableCallInfo = {
  count: number;
  oldest_created_at: number;
  reasons: string[];
};

const REASON_LABEL: Record<string, string> = {
  service: "Service",
  bill: "Bill",
  water: "Water",
  other: "Help",
};

export default function TablesPage() {
  const router = useRouter();
  const { session } = useSession();
  const tenant = useTenant();
  const tables = useQuery(
    api.tables.listWithCurrentOrder,
    tenant.args ?? "skip"
  ) as TableWithOrder[] | undefined;
  const staff = useQuery(
    api.staff.list,
    tenant.args ? { ...tenant.args, active_only: true } : "skip"
  );
  const upcoming = useQuery(api.reservations.listNextPerTable, tenant.args ?? "skip");
  const openCalls = useQuery(api.waiterCalls.openByTable, tenant.args ?? "skip");
  const todayTotals = useQuery(api.orders.tableTotalsToday, tenant.args ?? "skip");
  const createTable = useMutation(api.tables.create);
  const updateTable = useMutation(api.tables.update);
  const updateStatus = useMutation(api.tables.updateStatus);
  const removeTable = useMutation(api.tables.remove);
  const acknowledgeAll = useMutation(api.waiterCalls.acknowledgeAllForTable);

  // Map table_id → open-call info for the per-card badges
  const callsByTable = new Map<string, TableCallInfo>();
  for (const c of openCalls ?? []) {
    callsByTable.set(c.table_id, {
      count: c.count,
      oldest_created_at: c.oldest_created_at,
      reasons: c.reasons,
    });
  }
  const totalOpenCalls = (openCalls ?? []).reduce((s, c) => s + c.count, 0);

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
  const [qrTable, setQrTable] = useState<TableWithOrder | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tableNumber.trim()) return;
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await createTable({ ...tenant.args, table_number: tableNumber.trim(), capacity: Number(capacity) });
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
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await updateStatus({ ...tenant.args, id: table._id, status: next });
      setSelected((prev) => (prev?._id === table._id ? { ...prev, status: next } : prev));
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleUpdateTable(
    table: TableWithOrder,
    table_number: string,
    capacity: number
  ): Promise<boolean> {
    if (!tenant.args) {
      toast.error("No active outlet");
      return false;
    }
    try {
      await updateTable({ ...tenant.args, id: table._id, table_number, capacity });
      setSelected((prev) =>
        prev?._id === table._id
          ? { ...prev, table_number: table_number.trim(), capacity }
          : prev
      );
      toast.success("Table updated");
      return true;
    } catch (e) {
      toast.error(getErrorMessage(e));
      return false;
    }
  }

  async function handleDeleteTable(table: TableWithOrder) {
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    if (table.status === "occupied") {
      toast.error("Cannot delete an occupied table. Close its order first.");
      return;
    }
    try {
      await removeTable({ ...tenant.args, id: table._id });
      toast.success("Table deleted");
      setSelected(null);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }

  function handleNewOrder(table: TableWithOrder, waiterId?: string) {
    const params = new URLSearchParams({ table: table._id });
    if (waiterId) params.set("waiter", waiterId);
    router.push(`/orders/new?${params.toString()}`);
  }

  async function handleAcknowledge(table: TableWithOrder) {
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      const count = await acknowledgeAll({
        ...tenant.args,
        table_id: table._id,
        acknowledged_by: session?.staff_id ?? undefined,
      });
      if (count > 0) toast.success(`Acknowledged ${count} call${count !== 1 ? "s" : ""}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
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

          {/* Quick actions */}
          <QuickActionsPanel variant="compact" className="mb-5" />

          {/* Summary pills */}
          {tables && tables.length > 0 && (
            <div className="flex gap-3 mb-5 flex-wrap items-center">
              <Pill color="green" label="Available" count={counts.available} />
              <Pill color="blue"  label="Occupied"  count={counts.occupied} />
              <Pill color="yellow" label="Reserved" count={counts.reserved} />
              {totalOpenCalls > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 animate-pulse">
                  <BellRing className="h-3.5 w-3.5" />
                  <span className="font-bold">{totalOpenCalls}</span> waiting
                </span>
              )}
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
                  openCall={callsByTable.get(table._id)}
                  todayTotal={todayTotals?.[table._id]}
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
            openCall={callsByTable.get(selected._id)}
            onClose={() => setSelected(null)}
            onStatusChange={handleStatusChange}
            onUpdate={handleUpdateTable}
            onNewOrder={handleNewOrder}
            onShowQr={() => setQrTable(selected)}
            onAcknowledge={() => handleAcknowledge(selected)}
            onDelete={() => handleDeleteTable(selected)}
          />
        )}
      </div>

      {qrTable && <QrModal table={qrTable} onClose={() => setQrTable(null)} />}
    </div>
  );
}

// ─── Table Card ───────────────────────────────────────────────────────────────

function TableCard({
  table,
  isSelected,
  nextReservation,
  openCall,
  todayTotal,
  onClick,
  onNewOrder,
}: {
  table: TableWithOrder;
  isSelected: boolean;
  nextReservation?: { customer_name: string; scheduled_at: number; party_size: number };
  openCall?: TableCallInfo;
  todayTotal?: { total: number; count: number };
  onClick: () => void;
  onNewOrder: () => void; // card quick-link — no waiter pre-selection
}) {
  return (
    <div
      className={cn(
        "border-2 rounded-xl p-4 cursor-pointer select-none transition-all hover:shadow-md relative",
        STATUS_CARD[table.status],
        isSelected && "ring-2 ring-primary ring-offset-2",
        openCall && "ring-2 ring-rose-500 ring-offset-1 animate-pulse"
      )}
      onClick={onClick}
    >
      {openCall && (
        <span
          aria-label={`${openCall.count} pending request(s)`}
          className="absolute -top-2 -right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-600 text-white shadow"
        >
          <BellRing className="h-2.5 w-2.5" />
          {openCall.count}
        </span>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <span className="font-semibold text-lg leading-none">{table.table_number}</span>
        <span className={cn("h-2.5 w-2.5 rounded-full mt-0.5 shrink-0", STATUS_DOT[table.status])} />
      </div>

      {/* Capacity + today's total */}
      <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground mb-2">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {table.capacity} seats
        </span>
        {todayTotal && todayTotal.total > 0 && (
          <span
            title={`${todayTotal.count} order${todayTotal.count !== 1 ? "s" : ""} today`}
            className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium tabular-nums"
          >
            {formatCurrency(todayTotal.total)}
          </span>
        )}
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
  openCall,
  onClose,
  onStatusChange,
  onUpdate,
  onNewOrder,
  onShowQr,
  onAcknowledge,
  onDelete,
}: {
  table: TableWithOrder;
  staff: StaffMember[];
  openCall?: TableCallInfo;
  onClose: () => void;
  onStatusChange: (table: TableWithOrder, next: TableStatus) => void;
  onUpdate: (table: TableWithOrder, table_number: string, capacity: number) => Promise<boolean>;
  onNewOrder: (table: TableWithOrder, waiterId?: string) => void;
  onShowQr: () => void;
  onAcknowledge: () => void;
  onDelete: () => void;
}) {
  const [selectedWaiterId, setSelectedWaiterId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editNumber, setEditNumber] = useState(table.table_number);
  const [editCapacity, setEditCapacity] = useState(String(table.capacity));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const order = table.currentOrder;

  // Today's orders for this table (active + closed) — the table's day history.
  const panelTenant = useTenant();
  const history = useQuery(
    api.orders.tableHistoryToday,
    panelTenant.args ? { ...panelTenant.args, tableId: table._id } : "skip"
  );

  // Reset the edit form + delete confirmation whenever a different table is selected
  useEffect(() => {
    setIsEditing(false);
    setConfirmingDelete(false);
    setEditNumber(table.table_number);
    setEditCapacity(String(table.capacity));
  }, [table._id, table.table_number, table.capacity]);

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    const capacityNum = Number(editCapacity);
    if (!editNumber.trim()) {
      toast.error("Table number / name is required");
      return;
    }
    if (!Number.isInteger(capacityNum) || capacityNum < 1) {
      toast.error("Capacity must be a whole number of at least 1");
      return;
    }
    setSaving(true);
    const ok = await onUpdate(table, editNumber, capacityNum);
    setSaving(false);
    if (ok) setIsEditing(false);
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-semibold">{table.table_number}</p>
          <p className="text-xs text-muted-foreground">{table.capacity} seats</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing((v) => !v)}
            aria-label="Edit table details"
            title="Edit table details"
            className={cn(
              "p-1 rounded text-muted-foreground hover:bg-accent",
              isEditing && "bg-accent text-foreground"
            )}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Edit details form */}
      {isEditing && (
        <form
          onSubmit={handleSaveEdit}
          className="px-4 py-3 border-b border-border bg-secondary/30 space-y-3"
        >
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Edit Details
          </p>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Table Number / Name</label>
            <input
              value={editNumber}
              onChange={(e) => setEditNumber(e.target.value)}
              placeholder="e.g. T7 or VIP-1"
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Capacity</label>
            <input
              type="number"
              min={1}
              value={editCapacity}
              onChange={(e) => setEditCapacity(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setEditNumber(table.table_number);
                setEditCapacity(String(table.capacity));
              }}
              className="px-4 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 p-4 space-y-5">
        {/* Open waiter calls */}
        {openCall && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-rose-700 dark:text-rose-300 animate-pulse" />
                <span className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  {openCall.count} pending request{openCall.count !== 1 ? "s" : ""}
                </span>
              </div>
              <span className="text-[11px] text-rose-700/80 dark:text-rose-300/80 tabular-nums">
                {formatRelative(openCall.oldest_created_at)}
              </span>
            </div>
            <p className="text-xs text-rose-800/80 dark:text-rose-200/80 mb-2.5">
              {openCall.reasons.map((r) => REASON_LABEL[r] ?? r).join(" · ")}
            </p>
            <button
              onClick={onAcknowledge}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-md hover:bg-rose-700 transition-colors"
            >
              <Check className="h-3.5 w-3.5" /> Acknowledge
            </button>
          </div>
        )}

        {/* Status badge */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Status</p>
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[table.status])} />
            <span className="text-sm font-medium">{STATUS_LABEL[table.status]}</span>
          </div>
        </div>

        {/* QR code for customer self-order */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Customer QR</p>
          <button
            onClick={onShowQr}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80 transition-colors"
          >
            <span className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              {table.qr_token ? "View / print QR" : "Generate QR"}
            </span>
            <ChevronRight className="h-4 w-4 opacity-60" />
          </button>
        </div>

        {/* Today's history for this table */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
            Today
          </p>
          {history === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No orders on this table yet today.</p>
          ) : (
            <div className="space-y-0.5">
              {history.map((h) => (
                <Link
                  key={h._id}
                  href={`/orders/${h._id}`}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{h.order_number}</span>
                    <span
                      className={cn(
                        "text-[11px] capitalize shrink-0",
                        ORDER_STATUS_COLOR[h.status] ?? "text-muted-foreground"
                      )}
                    >
                      {h.status}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {h.item_count} item{h.item_count !== 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums shrink-0">
                    {formatCurrency(h.total)}
                  </span>
                </Link>
              ))}
              <div className="flex items-center justify-between text-xs pt-1.5 mt-1 border-t border-border">
                <span className="text-muted-foreground">
                  {history.length} order{history.length !== 1 ? "s" : ""} today
                </span>
                <span className="tabular-nums font-semibold">
                  {formatCurrency(
                    history
                      .filter((h) => h.status !== "cancelled")
                      .reduce((s, h) => s + h.total, 0)
                  )}
                </span>
              </div>
            </div>
          )}
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

        {table.status !== "occupied" && (
          <div className="pt-3 border-t border-border">
            {confirmingDelete ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2.5">
                <p className="text-sm font-medium text-destructive">
                  Delete table {table.table_number}?
                </p>
                <p className="text-xs text-muted-foreground">
                  This permanently removes the table. This can’t be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setConfirmingDelete(false);
                      onDelete();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-destructive text-white rounded-md hover:bg-destructive/90 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="flex-1 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center justify-center gap-2 w-full py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete table
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────

function QrModal({
  table,
  onClose,
}: {
  table: TableWithOrder;
  onClose: () => void;
}) {
  const tenant = useTenant();
  const issueQr = useMutation(api.tables.issueQrToken);
  const [token, setToken] = useState<string | null>(table.qr_token ?? null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/order/${token}`
      : null;

  // Mint a token if the table doesn't have one yet — happens once.
  useEffect(() => {
    if (token) return;
    if (!tenant.args) return;
    let cancelled = false;
    setIssuing(true);
    issueQr({ ...tenant.args, id: table._id })
      .then((t) => {
        if (!cancelled) setToken(t);
      })
      .catch((e) => toast.error(getErrorMessage(e)))
      .finally(() => {
        if (!cancelled) setIssuing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, table._id, issueQr, tenant.args]);

  // Render the QR as a PNG data URL once we have a URL.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 480,
    })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch((e) => toast.error(getErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function handleRotate() {
    if (!confirm("Rotate token? The current printed QR will stop working.")) return;
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      const next = await issueQr({ ...tenant.args, id: table._id, rotate: true });
      setToken(next);
      setDataUrl(null);
      toast.success("New QR generated");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }

  function handlePrint() {
    if (!dataUrl) return;
    const win = window.open("", "_blank", "width=420,height=620");
    if (!win) return;
    win.document.write(`<!doctype html>
<html><head><title>Table ${escapeHtml(table.table_number)} QR</title>
<style>
  body { font-family: system-ui, sans-serif; text-align: center; padding: 32px; margin: 0; }
  .label { font-size: 14px; color: #555; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .table { font-size: 32px; font-weight: 700; margin-bottom: 18px; }
  img { width: 280px; height: 280px; }
  .hint { font-size: 13px; color: #555; margin-top: 18px; line-height: 1.4; }
</style></head>
<body>
  <div class="label">Scan to order</div>
  <div class="table">Table ${escapeHtml(table.table_number)}</div>
  <img src="${dataUrl}" alt="QR for table ${escapeHtml(table.table_number)}" />
  <div class="hint">Point your phone camera at the code.<br/>Your waiter will confirm and bring the bill at the end.</div>
  <script>window.onload = () => { window.print(); };</script>
</body></html>`);
    win.document.close();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Customer QR
            </p>
            <h2 className="text-base font-semibold">Table {table.table_number}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center bg-background border border-border rounded-lg py-6">
          {issuing || !dataUrl ? (
            <div className="h-[240px] w-[240px] flex items-center justify-center text-xs text-muted-foreground">
              Generating…
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={`QR for table ${table.table_number}`}
              className="h-[240px] w-[240px]"
            />
          )}
          {url && (
            <p className="text-[11px] text-muted-foreground mt-3 max-w-[260px] break-all text-center">
              {url}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={handlePrint}
            disabled={!dataUrl}
            className="flex items-center justify-center gap-1.5 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
          <button
            onClick={handleRotate}
            disabled={!token}
            className="flex items-center justify-center gap-1.5 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" /> Rotate
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          Place this QR on the table tent. Customers can scan it to view the
          menu and add items to the table&apos;s order — the waiter still
          confirms and fires the KOT.
        </p>
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
