import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

export const list = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const stocks = await ctx.db
      .query("inventory_stock")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
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
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const stocks = await ctx.db
      .query("inventory_stock")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
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
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("inventory_stock"),
    quantity: v.optional(v.number()),
    unit: v.optional(v.string()),
    low_stock_threshold: v.optional(v.number()),
  },
  handler: async (ctx, { token, outletId, id, ...fields }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    await ctx.db.patch(id, fields);
  },
});

export const restock = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("inventory_stock"),
    quantity: v.number(),
  },
  handler: async (ctx, { token, outletId, id, quantity }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    // FIX [HIGH-5 Security]: Reject non-positive restock quantities
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Restock quantity must be a positive integer");
    }
    const stock = await ctx.db.get(id);
    if (!stock) throw new Error("Stock record not found");
    assertSameOutlet(stock, oid);
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
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("inventory_stock"),
    quantity: v.number(),
    reason: v.optional(v.string()),
    staff_id: v.optional(v.id("restaurant_staff")),
  },
  handler: async (ctx, { token, outletId, id, quantity, reason, staff_id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Dump quantity must be a positive integer");
    }
    const stock = await ctx.db.get(id);
    if (!stock) throw new Error("Stock record not found");
    assertSameOutlet(stock, oid);
    if (quantity > stock.quantity) {
      throw new Error(
        `Cannot dump ${quantity} — only ${stock.quantity} in stock`
      );
    }
    await ctx.db.patch(id, { quantity: stock.quantity - quantity });
    return await ctx.db.insert("inventory_dumps", {
      outlet_id: oid,
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
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    since: v.optional(v.number()),
  },
  handler: async (ctx, { token, outletId, since }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const startOfToday = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const from = since ?? startOfToday;
    // No compound by_outlet+dumped_at index: read the outlet's dumps, then
    // filter to the window and sort newest-first in JS.
    const rows = (
      await ctx.db
        .query("inventory_dumps")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    )
      .filter((r) => r.dumped_at >= from)
      .sort((a, b) => b.dumped_at - a.dumped_at);
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
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("inventory_dumps"),
    restore: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, id, restore }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const dumpRow = await ctx.db.get(id);
    if (!dumpRow) throw new Error("Dump record not found");
    assertSameOutlet(dumpRow, oid);
    if (restore) {
      // Put the quantity back into THIS outlet's matching stock row, if any.
      const stock = (
        await ctx.db
          .query("inventory_stock")
          .withIndex("by_menu_item", (q) =>
            q.eq("menu_item_id", dumpRow.menu_item_id)
          )
          .collect()
      ).find((s) => s.outlet_id === oid);
      if (stock) {
        await ctx.db.patch(stock._id, {
          quantity: stock.quantity + dumpRow.quantity,
        });
      }
    }
    await ctx.db.delete(id);
  },
});
