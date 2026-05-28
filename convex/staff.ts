import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireManager } from "./users";

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
    await requireManager(ctx);
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
    await requireManager(ctx);
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("restaurant_staff") },
  handler: async (ctx, { id }) => {
    await requireManager(ctx);
    // If the staff member has a linked login, remove the auth user too —
    // otherwise the orphaned account could still sign in.
    const staff = await ctx.db.get(id);
    if (staff?.user_id) {
      await ctx.db.delete(staff.user_id);
    }
    await ctx.db.delete(id);
  },
});
