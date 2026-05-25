"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";

type TableStatus = "available" | "occupied" | "reserved";

const STATUS_STYLE: Record<TableStatus, string> = {
  available: "border-green-400 bg-green-50 dark:bg-green-950/20",
  occupied: "border-primary bg-primary/5",
  reserved: "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20",
};

const STATUS_DOT: Record<TableStatus, string> = {
  available: "bg-green-500",
  occupied: "bg-primary",
  reserved: "bg-yellow-500",
};

export default function TablesPage() {
  const tables = useQuery(api.tables.list);
  const createTable = useMutation(api.tables.create);
  const updateStatus = useMutation(api.tables.updateStatus);
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

  async function handleStatusCycle(id: Id<"restaurant_tables">, current: TableStatus) {
    const next: Record<TableStatus, TableStatus> = {
      available: "reserved",
      reserved: "available",
      occupied: "available",
    };
    try {
      await updateStatus({ id, status: next[current] });
    } catch {
      toast.error("Failed to update status");
    }
  }

  const addBtn = (
    <button
      onClick={() => setShowAdd(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Table
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Tables" action={addBtn} />
      <div className="flex-1 p-6">

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
              <div
                key={table._id}
                className={cn(
                  "border-2 rounded-xl p-4 cursor-pointer select-none transition-all hover:shadow-md",
                  STATUS_STYLE[table.status]
                )}
                onClick={() => handleStatusCycle(table._id, table.status)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="font-semibold text-lg">{table.table_number}</span>
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full mt-1",
                      STATUS_DOT[table.status]
                    )}
                  />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>{table.capacity}</span>
                </div>
                <p className="text-xs capitalize text-muted-foreground mt-2">
                  {table.status}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Click a table to cycle status: available → reserved → available
        </p>
      </div>
    </div>
  );
}
