"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { useSession } from "@/components/auth/session-context";
import { formatDateTime } from "@/lib/utils";
import { AlertTriangle, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function InventoryPage() {
  const { session } = useSession();
  const stocks = useQuery(api.inventory.list);
  const dumps = useQuery(api.inventory.dumpsRecent, {});
  const updateStock = useMutation(api.inventory.update);
  const restockMutation = useMutation(api.inventory.restock);
  const dumpMutation = useMutation(api.inventory.dump);
  const removeDump = useMutation(api.inventory.removeDump);

  const [restockId, setRestockId] = useState<Id<"inventory_stock"> | null>(null);
  const [restockQty, setRestockQty] = useState("10");

  const [dumpFor, setDumpFor] = useState<{
    id: Id<"inventory_stock">;
    name: string;
    available: number;
  } | null>(null);
  const [dumpQty, setDumpQty] = useState("1");
  const [dumpReason, setDumpReason] = useState("");
  const [dumpBusy, setDumpBusy] = useState(false);

  async function handleRestock(e: React.FormEvent) {
    e.preventDefault();
    if (!restockId) return;
    try {
      await restockMutation({ id: restockId, quantity: Number(restockQty) });
      toast.success("Stock updated");
      setRestockId(null);
      setRestockQty("10");
    } catch {
      toast.error("Failed to update stock");
    }
  }

  async function handleThresholdChange(id: Id<"inventory_stock">, value: string) {
    const num = Number(value);
    if (isNaN(num) || num < 0) return;
    try {
      await updateStock({ id, low_stock_threshold: num });
    } catch {
      toast.error("Failed to update threshold");
    }
  }

  async function handleDumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dumpFor) return;
    const qty = Number(dumpQty);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error("Enter a positive whole number");
      return;
    }
    if (qty > dumpFor.available) {
      toast.error(`Only ${dumpFor.available} available`);
      return;
    }
    setDumpBusy(true);
    try {
      await dumpMutation({
        id: dumpFor.id,
        quantity: qty,
        reason: dumpReason.trim() || undefined,
        staff_id: session?.staff_id ?? undefined,
      });
      toast.success(`Dumped ${qty} ${dumpFor.name}`);
      setDumpFor(null);
      setDumpReason("");
      setDumpQty("1");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dump");
    } finally {
      setDumpBusy(false);
    }
  }

  async function handleUndoDump(id: Id<"inventory_dumps">, restore: boolean) {
    try {
      await removeDump({ id, restore });
      toast.success(restore ? "Dump reverted to stock" : "Dump deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const lowCount = stocks?.filter((s) => s.quantity <= s.low_stock_threshold).length ?? 0;
  const dumpsTotal = (dumps ?? []).reduce((s, d) => s + d.quantity, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Inventory" />
      <div className="flex-1 p-6 space-y-4">

        {lowCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {lowCount} item{lowCount !== 1 ? "s" : ""} below low-stock threshold
          </div>
        )}

        {/* Restock form */}
        {restockId && (
          <form
            onSubmit={handleRestock}
            className="bg-card border border-border rounded-lg p-4 max-w-xs space-y-3"
          >
            <h3 className="text-sm font-medium">Restock</h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Add Quantity</label>
              <input
                type="number"
                min={1}
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90">
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setRestockId(null)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Stock table */}
        {stocks === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : stocks.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            No inventory items. Enable inventory tracking on menu items.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unit</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Alert At</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stocks.map((s) => {
                  const isLow = s.quantity <= s.low_stock_threshold;
                  return (
                    <tr key={s._id} className={cn(isLow && "bg-destructive/5")}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{s.menu_item?.name ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={cn("font-semibold", isLow ? "text-destructive" : "text-foreground")}>
                          {s.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{s.unit}</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          defaultValue={s.low_stock_threshold}
                          onBlur={(e) => handleThresholdChange(s._id, e.target.value)}
                          className="w-16 px-2 py-1 text-sm text-right rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isLow ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-destructive/10 text-destructive font-medium">
                            Low
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-medium">
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => {
                              setRestockId(s._id);
                              setRestockQty("10");
                            }}
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Plus className="h-3 w-3" /> Restock
                          </button>
                          <button
                            disabled={s.quantity <= 0}
                            onClick={() => {
                              setDumpFor({
                                id: s._id,
                                name: s.menu_item?.name ?? "item",
                                available: s.quantity,
                              });
                              setDumpQty(String(Math.min(1, s.quantity)));
                              setDumpReason("");
                            }}
                            className="flex items-center gap-1 text-xs text-destructive hover:underline disabled:text-muted-foreground disabled:cursor-not-allowed disabled:no-underline"
                          >
                            <Trash2 className="h-3 w-3" /> Dump
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Today's dumps */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium text-sm">Dumps Today</h2>
            </div>
            {dumpsTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                {dumpsTotal} unit{dumpsTotal !== 1 ? "s" : ""} discarded today
              </span>
            )}
          </div>
          {dumps === undefined ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : dumps.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing has been dumped today.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Qty</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Reason</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">When</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">By</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dumps.map((d) => (
                  <tr key={d._id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-2.5">{d.menu_item?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{d.quantity}</td>
                    <td className="px-4 py-2.5 text-muted-foreground italic">
                      {d.reason ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(d.dumped_at)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {d.staff?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleUndoDump(d._id, true)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Add the quantity back to stock and delete this log"
                        >
                          <Undo2 className="h-3 w-3" /> Undo
                        </button>
                        <button
                          onClick={() => handleUndoDump(d._id, false)}
                          className="text-xs text-muted-foreground hover:text-destructive hover:underline"
                          title="Delete the log without touching stock"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Dump modal */}
      {dumpFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !dumpBusy && setDumpFor(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleDumpSubmit}
            className="bg-card border border-border rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl"
          >
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                <Trash2 className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Dump {dumpFor.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {dumpFor.available} available in stock
                </p>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Quantity to dump</label>
              <input
                type="number"
                autoFocus
                min={1}
                max={dumpFor.available}
                value={dumpQty}
                onChange={(e) => setDumpQty(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right tabular-nums"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setDumpQty(String(dumpFor.available))}
                  className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/70"
                >
                  Dump all ({dumpFor.available})
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Reason (optional)
              </label>
              <input
                value={dumpReason}
                onChange={(e) => setDumpReason(e.target.value)}
                placeholder="e.g. spoiled, end-of-day waste"
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={dumpBusy}
                onClick={() => setDumpFor(null)}
                className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={dumpBusy}
                className="px-3 py-1.5 bg-destructive text-white rounded-md text-sm hover:bg-destructive/90 disabled:opacity-50"
              >
                {dumpBusy ? "Dumping…" : "Confirm dump"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
