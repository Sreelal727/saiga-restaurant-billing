import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { active_only: v.optional(v.boolean()) },
  handler: async (ctx, { active_only }) => {
    const all = await ctx.db.query("restaurant_staff").collect();
    return active_only ? all.filter((s) => s.is_active) : all;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    role: v.union(v.literal("waiter"), v.literal("manager"), v.literal("cashier")),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("restaurant_staff", {
      ...args,
      is_active: true,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("restaurant_staff"),
    name: v.optional(v.string()),
    role: v.optional(
      v.union(v.literal("waiter"), v.literal("manager"), v.literal("cashier"))
    ),
    phone: v.optional(v.string()),
    is_active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("restaurant_staff") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
