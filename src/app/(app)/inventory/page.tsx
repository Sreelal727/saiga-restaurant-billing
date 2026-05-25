"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { AlertTriangle, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function InventoryPage() {
  const stocks = useQuery(api.inventory.list);
  const updateStock = useMutation(api.inventory.update);
  const restockMutation = useMutation(api.inventory.restock);

  const [restockId, setRestockId] = useState<Id<"inventory_stock"> | null>(null);
  const [restockQty, setRestockQty] = useState("10");

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

  const lowCount = stocks?.filter((s) => s.quantity <= s.low_stock_threshold).length ?? 0;

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
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
              >
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
                        <button
                          onClick={() => {
                            setRestockId(s._id);
                            setRestockQty("10");
                          }}
                          className="flex items-center gap-1 ml-auto text-xs text-primary hover:underline"
                        >
                          <Plus className="h-3 w-3" /> Restock
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
