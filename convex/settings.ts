import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireManager } from "./users";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("restaurant_settings").collect();
    return rows[0] ?? null;
  },
});

export const upsert = mutation({
  args: {
    restaurant_name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    default_packing_charge: v.number(),
    default_delivery_charge: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    await requireManager(ctx);
    // FIX [MEDIUM-10 Security]: Validate currency symbol length
    if (args.currency.trim().length === 0 || args.currency.length > 5) {
      throw new Error("Currency symbol must be 1–5 characters");
    }
    const rows = await ctx.db.query("restaurant_settings").collect();
    if (rows[0]) {
      await ctx.db.patch(rows[0]._id, args);
      return rows[0]._id;
    }
    return await ctx.db.insert("restaurant_settings", args);
  },
});
