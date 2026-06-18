import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

export const list = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    active_only: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, active_only }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const all = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    return active_only ? all.filter((s) => s.is_active) : all;
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    name: v.string(),
    role: v.union(v.literal("waiter"), v.literal("manager"), v.literal("cashier")),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, { token, outletId, ...args }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    return await ctx.db.insert("restaurant_staff", {
      ...args,
      outlet_id: oid,
      is_active: true,
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_staff"),
    name: v.optional(v.string()),
    role: v.optional(
      v.union(v.literal("waiter"), v.literal("manager"), v.literal("cashier"))
    ),
    phone: v.optional(v.string()),
    is_active: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, id, ...fields }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_staff"),
  },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    await ctx.db.delete(id);
  },
});
