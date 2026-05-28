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

/**
 * Categories with their menu item counts (active + inactive).
 * Used by the admin Menu page to show "N items" badges and decide
 * whether deletion is safe.
 */
export const listWithCounts = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .collect();

    return Promise.all(
      categories.map(async (cat) => {
        const items = await ctx.db
          .query("menu_items")
          .withIndex("by_category", (q) => q.eq("category_id", cat._id))
          .collect();
        return { ...cat, item_count: items.length };
      })
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    display_order: v.number(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) throw new Error("Category name is required");
    return await ctx.db.insert("menu_categories", {
      name,
      display_order: args.display_order,
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
  handler: async (ctx, { id, name, display_order, is_active }) => {
    if (name !== undefined && name.trim().length === 0) {
      throw new Error("Category name cannot be empty");
    }
    await ctx.db.patch(id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(display_order !== undefined ? { display_order } : {}),
      ...(is_active !== undefined ? { is_active } : {}),
    });
  },
});

/**
 * Swap display_order with the immediate neighbour. `direction` is "up"
 * (lower display_order) or "down" (higher). Boundary calls are no-ops.
 */
export const reorder = mutation({
  args: {
    id: v.id("menu_categories"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { id, direction }) => {
    const current = await ctx.db.get(id);
    if (!current) throw new Error("Category not found");

    const all = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .collect();
    const index = all.findIndex((c) => c._id === id);
    if (index === -1) return;

    const swapWith =
      direction === "up" ? all[index - 1] : all[index + 1];
    if (!swapWith) return; // already at the boundary

    await ctx.db.patch(current._id, { display_order: swapWith.display_order });
    await ctx.db.patch(swapWith._id, { display_order: current.display_order });
  },
});

export const remove = mutation({
  args: { id: v.id("menu_categories") },
  handler: async (ctx, { id }) => {
    // Block hard-delete if any menu item still references this category —
    // otherwise the items would become orphans pointing at a missing ID.
    const orphan = await ctx.db
      .query("menu_items")
      .withIndex("by_category", (q) => q.eq("category_id", id))
      .first();
    if (orphan) {
      throw new Error(
        "Cannot delete a category that still has menu items. " +
          "Move or delete the items first, or deactivate the category instead."
      );
    }
    await ctx.db.delete(id);
  },
});
