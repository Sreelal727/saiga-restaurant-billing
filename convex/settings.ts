import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet } from "./lib/tenant";

export const get = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const rows = await ctx.db
      .query("restaurant_settings")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    return rows[0] ?? null;
  },
});

export const upsert = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    restaurant_name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    default_packing_charge: v.number(),
    default_delivery_charge: v.number(),
    currency: v.string(),
    bill_paper_width: v.optional(v.number()),
  },
  handler: async (ctx, { token, outletId, ...fields }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    // FIX [MEDIUM-10 Security]: Validate currency symbol length
    if (fields.currency.trim().length === 0 || fields.currency.length > 5) {
      throw new Error("Currency symbol must be 1–5 characters");
    }
    const rows = await ctx.db
      .query("restaurant_settings")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    if (rows[0]) {
      await ctx.db.patch(rows[0]._id, { ...fields, outlet_id: oid });
      return rows[0]._id;
    }
    return await ctx.db.insert("restaurant_settings", { ...fields, outlet_id: oid });
  },
});
