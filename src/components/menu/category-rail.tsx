"use client";

import { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

// Cycle of tile colours so each category gets a distinct, colourful tile.
const TILE_COLORS = [
  "bg-orange-500",
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-pink-500",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-fuchsia-500",
];

export function categoryColor(index: number): string {
  return TILE_COLORS[index % TILE_COLORS.length];
}

interface RailCategory {
  _id: Id<"menu_categories">;
  name: string;
  items: ReadonlyArray<unknown>;
  is_active?: boolean;
}

/**
 * Vertical rail of colourful category tiles, shown on the left inside a tab.
 * Clicking a tile selects that category; the active one is highlighted.
 */
export function CategoryRail({
  categories,
  selectedId,
  onSelect,
}: {
  categories: ReadonlyArray<RailCategory>;
  selectedId: Id<"menu_categories"> | null;
  onSelect: (id: Id<"menu_categories">) => void;
}) {
  return (
    <div className="flex flex-row gap-2 overflow-x-auto pb-2 -mb-2 w-full shrink-0 sm:flex-col sm:overflow-x-visible sm:pb-0 sm:mb-0 sm:w-40">
      {categories.map((cat, i) => {
        const active = cat._id === selectedId;
        return (
          <button
            key={cat._id}
            type="button"
            onClick={() => onSelect(cat._id)}
            className={cn(
              "text-left rounded-xl p-3 text-white transition-all shrink-0 w-28 sm:w-auto",
              categoryColor(i),
              active
                ? "ring-2 ring-offset-2 ring-foreground shadow-md sm:scale-[1.02]"
                : "opacity-80 hover:opacity-100",
              cat.is_active === false && "grayscale"
            )}
          >
            <p className="font-semibold text-sm leading-tight">{cat.name}</p>
            <p className="text-[11px] text-white/80 mt-1">
              {cat.items.length} item{cat.items.length === 1 ? "" : "s"}
            </p>
          </button>
        );
      })}
    </div>
  );
}
