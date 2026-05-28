import type { TestConvex } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import type schema from "../convex/schema";

export type SeededIds = {
  categoryId: Id<"menu_categories">;
  trackedItemId: Id<"menu_items">;
  untrackedItemId: Id<"menu_items">;
  inactiveItemId: Id<"menu_items">;
  trackedStockId: Id<"inventory_stock">;
  tableId: Id<"restaurant_tables">;
  waiterId: Id<"restaurant_staff">;
};

/**
 * Seed a minimal but realistic dataset: one category, three menu items
 * (tracked / untracked / inactive), a stock row for the tracked item,
 * one available dine-in table, and one waiter.
 */
export async function seed(
  t: TestConvex<typeof schema>,
  opts: { trackedStockQty?: number } = {}
): Promise<SeededIds> {
  const trackedStockQty = opts.trackedStockQty ?? 10;

  return t.run(async (ctx) => {
    const categoryId = await ctx.db.insert("menu_categories", {
      name: "Starters",
      display_order: 1,
      is_active: true,
    });

    const trackedItemId = await ctx.db.insert("menu_items", {
      category_id: categoryId,
      name: "Paneer Tikka",
      price: 200,
      is_veg: true,
      is_active: true,
      has_inventory: true,
    });

    const untrackedItemId = await ctx.db.insert("menu_items", {
      category_id: categoryId,
      name: "Veg Spring Roll",
      price: 150,
      is_veg: true,
      is_active: true,
      has_inventory: false,
    });

    const inactiveItemId = await ctx.db.insert("menu_items", {
      category_id: categoryId,
      name: "Discontinued Special",
      price: 999,
      is_veg: true,
      is_active: false,
      has_inventory: false,
    });

    const trackedStockId = await ctx.db.insert("inventory_stock", {
      menu_item_id: trackedItemId,
      quantity: trackedStockQty,
      unit: "plate",
      low_stock_threshold: 3,
    });

    const tableId = await ctx.db.insert("restaurant_tables", {
      table_number: "T1",
      capacity: 4,
      status: "available",
    });

    const waiterId = await ctx.db.insert("restaurant_staff", {
      name: "Ravi",
      role: "waiter",
      is_active: true,
    });

    return {
      categoryId,
      trackedItemId,
      untrackedItemId,
      inactiveItemId,
      trackedStockId,
      tableId,
      waiterId,
    };
  });
}

/**
 * Default charge args shared across tests — every field that orders.create
 * requires besides `items` and the optional table/waiter/customer bits.
 */
export const ZERO_CHARGES = {
  discount_percent: 0,
  cgst_rate: 0,
  sgst_rate: 0,
  tips: 0,
  packing_charge: 0,
  delivery_charge: 0,
};
