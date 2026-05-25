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
