import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    display_order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("menu_categories", {
      ...args,
      is_active: true,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("menu_categories"),
    name: v.optional(v.string()),
    display_order: v.optional(v.number()),
    is_active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("menu_categories") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
