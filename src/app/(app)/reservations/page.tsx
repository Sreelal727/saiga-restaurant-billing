"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { Plus, X, Search, Users, Phone, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "cancelled"
  | "no_show";

const STATUS_STYLE: Record<ReservationStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  seated: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  no_show: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This Week" },
  { key: "all", label: "All" },
] as const;
type Preset = (typeof PRESETS)[number]["key"];

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function getRange(preset: Preset): { from?: number; to?: number } {
  const now = new Date();
  switch (preset) {
    case "today": {
      const start = startOfDay(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start.getTime(), to: end.getTime() };
    }
    case "tomorrow": {
      const start = startOfDay(now);
      start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start.getTime(), to: end.getTime() };
    }
    case "week": {
      const start = startOfDay(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { from: start.getTime(), to: end.getTime() };
    }
    case "all":
      return {};
  }
}

function defaultDateTimeLocal(): string {
  // 19:00 tomorrow as a sensible default
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

const EMPTY_FORM = {
  table_id: "" as Id<"restaurant_tables"> | "",
  customer_name: "",
  customer_phone: "",
  party_size: "2",
  scheduled_at: defaultDateTimeLocal(),
  duration_minutes: "90",
  notes: "",
};

export default function ReservationsPage() {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>("today");
  const [search, setSearch] = useState("");

  const range = useMemo(() => getRange(preset), [preset]);

  const reservations = useQuery(api.reservations.list, {
    from: range.from,
    to: range.to,
    search: search.trim() || undefined,
  });
  const tables = useQuery(api.tables.list);

  const create = useMutation(api.reservations.create);
  const cancel = useMutation(api.reservations.cancel);
  const markNoShow = useMutation(api.reservations.markNoShow);
  const markSeated = useMutation(api.reservations.markSeated);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.table_id) {
      toast.error("Pick a table");
      return;
    }
    const dt = new Date(form.scheduled_at).getTime();
    if (!Number.isFinite(dt)) {
      toast.error("Enter a valid date/time");
      return;
    }
    try {
      await create({
        table_id: form.table_id as Id<"restaurant_tables">,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        party_size: Number(form.party_size),
        scheduled_at: dt,
        duration_minutes: Number(form.duration_minutes),
        notes: form.notes || undefined,
      });
      toast.success("Reservation created");
      setShowForm(false);
      setForm({ ...EMPTY_FORM, scheduled_at: defaultDateTimeLocal() });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    }
  }

  async function handleCancel(id: Id<"restaurant_reservations">) {
    if (!confirm("Cancel this reservation?")) return;
    try {
      await cancel({ id });
      toast.success("Reservation cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleNoShow(id: Id<"restaurant_reservations">) {
    try {
      await markNoShow({ id });
      toast.success("Marked as no-show");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleSeat(
    id: Id<"restaurant_reservations">,
    tableId: Id<"restaurant_tables">,
    waiterId?: Id<"restaurant_staff">
  ) {
    try {
      await markSeated({ id });
      toast.success("Party seated — opening new order");
      const params = new URLSearchParams({ table: tableId });
      if (waiterId) params.set("waiter", waiterId);
      router.push(`/orders/new?${params.toString()}&reservation=${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to seat");
    }
  }

  const addBtn = (
    <button
      onClick={() => {
        setForm({ ...EMPTY_FORM, scheduled_at: defaultDateTimeLocal() });
        setShowForm(true);
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> New Reservation
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Reservations" action={addBtn} />
      <div className="flex-1 p-6 space-y-4">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  preset === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full pl-9 pr-9 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
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
        </div>

        {/* Form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="bg-card border border-border rounded-lg p-4 max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            <h3 className="font-medium text-sm sm:col-span-2">New Reservation</h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Table</label>
              <select
                value={form.table_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    table_id: e.target.value as Id<"restaurant_tables">,
                  }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Select Table —</option>
                {tables?.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.table_number} (seats {t.capacity})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Party size</label>
              <input
                type="number"
                min={1}
                value={form.party_size}
                onChange={(e) =>
                  setForm((f) => ({ ...f, party_size: e.target.value }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, scheduled_at: e.target.value }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Duration (min)
              </label>
              <input
                type="number"
                min={15}
                step={15}
                value={form.duration_minutes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, duration_minutes: e.target.value }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Customer name
              </label>
              <input
                value={form.customer_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, customer_name: e.target.value }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Customer phone
              </label>
              <input
                value={form.customer_phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, customer_phone: e.target.value }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. anniversary, allergies"
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Reservations list */}
        {reservations === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : reservations.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            No reservations in this range
          </div>
        ) : (
          <div className="space-y-2">
            {reservations.map((r) => (
              <ReservationCard
                key={r._id}
                r={r}
                onCancel={() => handleCancel(r._id)}
                onNoShow={() => handleNoShow(r._id)}
                onSeat={() => handleSeat(r._id, r.table_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type CardReservation = {
  _id: Id<"restaurant_reservations">;
  status: ReservationStatus;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  scheduled_at: number;
  duration_minutes: number;
  notes?: string;
  table: { _id: Id<"restaurant_tables">; table_number: string } | null;
};

function ReservationCard({
  r,
  onCancel,
  onNoShow,
  onSeat,
}: {
  r: CardReservation;
  onCancel: () => void;
  onNoShow: () => void;
  onSeat: () => void;
}) {
  const upcoming = r.status === "confirmed" || r.status === "pending";
  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-4">
      <div className="text-center px-2">
        <p className="text-lg font-semibold tabular-nums">
          {new Date(r.scheduled_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(r.scheduled_at).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })}
        </p>
      </div>

      <div className="h-10 w-px bg-border" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{r.customer_name}</span>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
              STATUS_STYLE[r.status]
            )}
          >
            {r.status === "no_show" ? "no show" : r.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" /> {r.party_size}
          </span>
          {r.table && <span>Table {r.table.table_number}</span>}
          <span className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> {r.customer_phone}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {r.duration_minutes} min
          </span>
        </div>
        {r.notes && (
          <p className="text-xs italic text-muted-foreground mt-0.5">{r.notes}</p>
        )}
      </div>

      {upcoming && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onSeat}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs hover:bg-primary/90"
          >
            Seat
          </button>
          <button
            onClick={onNoShow}
            className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs hover:bg-secondary/70"
          >
            No show
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs hover:bg-destructive hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
