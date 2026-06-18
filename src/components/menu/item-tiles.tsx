"use client";

import { Id } from "../../../convex/_generated/dataModel";
import { formatCurrency, cn } from "@/lib/utils";
import { Plus, Minus } from "lucide-react";

export interface TileVariant {
  label: string;
  price: number;
  unit_factor?: number;
}

export interface TileItem {
  _id: Id<"menu_items">;
  name: string;
  description?: string;
  price: number;
  is_veg?: boolean;
  open_price?: boolean;
  variants?: TileVariant[];
}

interface ItemTilesProps {
  items: ReadonlyArray<TileItem>;
  /** Current quantity of an item (+ chosen portion) in the cart, 0 if none. */
  qtyOf: (id: Id<"menu_items">, label?: string) => number;
  onAdd: (item: TileItem, variant?: TileVariant) => void;
  onInc: (id: Id<"menu_items">, label?: string) => void;
  onDec: (id: Id<"menu_items">, label?: string) => void;
}

/**
 * Grid of tappable item tiles for the ordering screens. Non-portioned items are
 * a single tile; portioned items show each size as a row inside the tile.
 */
export function ItemTiles({ items, qtyOf, onAdd, onInc, onDec }: ItemTilesProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((item) => {
        const variants = item.variants ?? [];
        const hasVariants = variants.length > 0;

        if (!hasVariants) {
          const qty = qtyOf(item._id, undefined);
          const priceLabel = item.open_price
            ? "As per size"
            : formatCurrency(item.price);
          return (
            <button
              key={item._id}
              type="button"
              onClick={() => (qty === 0 ? onAdd(item) : onInc(item._id))}
              className={cn(
                "relative flex flex-col text-left rounded-xl border p-3 min-h-[5.5rem] transition-colors",
                qty > 0
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-accent"
              )}
            >
              <div className="flex items-start gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full mt-1 shrink-0",
                    item.is_veg ? "bg-green-500" : "bg-red-500"
                  )}
                />
                <span className="text-sm font-medium leading-tight line-clamp-2">
                  {item.name}
                </span>
              </div>
              <div className="mt-auto flex items-end justify-between pt-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {priceLabel}
                </span>
                {qty > 0 ? (
                  <Stepper
                    qty={qty}
                    onDec={(e) => {
                      e.stopPropagation();
                      onDec(item._id);
                    }}
                    onInc={(e) => {
                      e.stopPropagation();
                      onInc(item._id);
                    }}
                  />
                ) : (
                  <span className="h-6 w-6 flex items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            </button>
          );
        }

        // Portioned item — one tile, each size selectable inside it.
        return (
          <div
            key={item._id}
            className="flex flex-col rounded-xl border border-border bg-card p-3 col-span-2 sm:col-span-1"
          >
            <div className="flex items-start gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full mt-1 shrink-0",
                  item.is_veg ? "bg-green-500" : "bg-red-500"
                )}
              />
              <span className="text-sm font-medium leading-tight line-clamp-2">
                {item.name}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {variants.map((vr) => {
                const qty = qtyOf(item._id, vr.label);
                return (
                  <div
                    key={vr.label}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
                      qty > 0 ? "bg-primary/5" : "hover:bg-accent"
                    )}
                  >
                    <span className="text-xs flex-1 min-w-0 truncate">{vr.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(vr.price)}
                    </span>
                    {qty > 0 ? (
                      <Stepper
                        qty={qty}
                        onDec={() => onDec(item._id, vr.label)}
                        onInc={() => onInc(item._id, vr.label)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAdd(item, vr)}
                        className="h-6 w-6 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                        aria-label={`Add ${vr.label}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stepper({
  qty,
  onInc,
  onDec,
}: {
  qty: number;
  onInc: (e: React.MouseEvent) => void;
  onDec: (e: React.MouseEvent) => void;
}) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span
        role="button"
        tabIndex={0}
        onClick={onDec}
        className="h-6 w-6 flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
        aria-label="Decrease"
      >
        <Minus className="h-3 w-3" />
      </span>
      <span className="w-5 text-center text-sm font-medium tabular-nums">{qty}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={onInc}
        className="h-6 w-6 flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent"
        aria-label="Increase"
      >
        <Plus className="h-3 w-3" />
      </span>
    </span>
  );
}
