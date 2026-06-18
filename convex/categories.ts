import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

export const list = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const cats = await ctx.db
      .query("menu_categories")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    return cats.sort((a, b) => a.display_order - b.display_order);
  },
});

/**
 * Categories with their menu item counts (active + inactive).
 * Used by the admin Menu page to show "N items" badges and decide
 * whether deletion is safe.
 */
export const listWithCounts = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const categories = (
      await ctx.db
        .query("menu_categories")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    ).sort((a, b) => a.display_order - b.display_order);

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
    token: v.string(),
    outletId: v.id("outlets"),
    name: v.string(),
    display_order: v.number(),
  },
  handler: async (ctx, { token, outletId, name: rawName, display_order }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const name = rawName.trim();
    if (name.length === 0) throw new Error("Category name is required");
    return await ctx.db.insert("menu_categories", {
      outlet_id: oid,
      name,
      display_order,
      is_active: true,
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("menu_categories"),
    name: v.optional(v.string()),
    display_order: v.optional(v.number()),
    is_active: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, id, name, display_order, is_active }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
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
 * Swap display_order with the immediate neighbour within the same outlet.
 * `direction` is "up" (lower display_order) or "down". Boundaries are no-ops.
 */
export const reorder = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("menu_categories"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { token, outletId, id, direction }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const current = await ctx.db.get(id);
    assertSameOutlet(current, oid);
    if (!current) return;

    const all = (
      await ctx.db
        .query("menu_categories")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    ).sort((a, b) => a.display_order - b.display_order);
    const index = all.findIndex((c) => c._id === id);
    if (index === -1) return;

    const swapWith = direction === "up" ? all[index - 1] : all[index + 1];
    if (!swapWith) return; // already at the boundary

    await ctx.db.patch(current._id, { display_order: swapWith.display_order });
    await ctx.db.patch(swapWith._id, { display_order: current.display_order });
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("menu_categories"),
  },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    // Block hard-delete if any menu item still references this category.
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
