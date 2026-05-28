import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const stocks = await ctx.db.query("inventory_stock").collect();
    const enriched = await Promise.all(
      stocks.map(async (s) => {
        const item = await ctx.db.get(s.menu_item_id);
        return { ...s, menu_item: item };
      })
    );
    return enriched.filter((s) => s.menu_item !== null);
  },
});

export const lowStock = query({
  args: {},
  handler: async (ctx) => {
    const stocks = await ctx.db.query("inventory_stock").collect();
    const low = stocks.filter((s) => s.quantity <= s.low_stock_threshold);
    return Promise.all(
      low.map(async (s) => {
        const item = await ctx.db.get(s.menu_item_id);
        return { ...s, menu_item: item };
      })
    );
  },
});

export const update = mutation({
  args: {
    id: v.id("inventory_stock"),
    quantity: v.optional(v.number()),
    unit: v.optional(v.string()),
    low_stock_threshold: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const restock = mutation({
  args: {
    id: v.id("inventory_stock"),
    quantity: v.number(),
  },
  handler: async (ctx, { id, quantity }) => {
    // FIX [HIGH-5 Security]: Reject non-positive restock quantities
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Restock quantity must be a positive integer");
    }
    const stock = await ctx.db.get(id);
    if (!stock) throw new Error("Stock record not found");
    await ctx.db.patch(id, {
      quantity: stock.quantity + quantity,
      last_restocked_at: Date.now(),
    });
  },
});

// ─── EOD dump / wastage ───────────────────────────────────────────────────────

/**
 * Discard `quantity` units of an inventory item — typical at end of day for
 * perishable stock that wasn't sold. Deducts from `inventory_stock` and
 * appends a row to `inventory_dumps` for later reporting.
 */
export const dump = mutation({
  args: {
    id: v.id("inventory_stock"),
    quantity: v.number(),
    reason: v.optional(v.string()),
    staff_id: v.optional(v.id("restaurant_staff")),
  },
  handler: async (ctx, { id, quantity, reason, staff_id }) => {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Dump quantity must be a positive integer");
    }
    const stock = await ctx.db.get(id);
    if (!stock) throw new Error("Stock record not found");
    if (quantity > stock.quantity) {
      throw new Error(
        `Cannot dump ${quantity} — only ${stock.quantity} in stock`
      );
    }
    await ctx.db.patch(id, { quantity: stock.quantity - quantity });
    return await ctx.db.insert("inventory_dumps", {
      menu_item_id: stock.menu_item_id,
      quantity,
      reason: reason?.trim() || undefined,
      dumped_at: Date.now(),
      staff_id,
    });
  },
});

/**
 * Recent dump events, newest-first, enriched with the menu item.
 * Default window is the current calendar day; pass `since` to override.
 */
export const dumpsRecent = query({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, { since }) => {
    const startOfToday = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const from = since ?? startOfToday;
    const rows = await ctx.db
      .query("inventory_dumps")
      .withIndex("by_dumped_at", (q) => q.gte("dumped_at", from))
      .order("desc")
      .collect();
    return Promise.all(
      rows.map(async (r) => {
        const [item, staff] = await Promise.all([
          ctx.db.get(r.menu_item_id),
          r.staff_id ? ctx.db.get(r.staff_id) : null,
        ]);
        return { ...r, menu_item: item, staff };
      })
    );
  },
});

export const removeDump = mutation({
  args: { id: v.id("inventory_dumps"), restore: v.optional(v.boolean()) },
  handler: async (ctx, { id, restore }) => {
    const dumpRow = await ctx.db.get(id);
    if (!dumpRow) throw new Error("Dump record not found");
    if (restore) {
      // Put the quantity back into the matching stock row, if it exists.
      const stock = await ctx.db
        .query("inventory_stock")
        .withIndex("by_menu_item", (q) =>
          q.eq("menu_item_id", dumpRow.menu_item_id)
        )
        .first();
      if (stock) {
        await ctx.db.patch(stock._id, {
          quantity: stock.quantity + dumpRow.quantity,
        });
      }
    }
    await ctx.db.delete(id);
  },
});
