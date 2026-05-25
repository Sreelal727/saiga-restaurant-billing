import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    category_id: v.optional(v.id("menu_categories")),
    active_only: v.optional(v.boolean()),
  },
  handler: async (ctx, { category_id, active_only }) => {
    let items = category_id
      ? await ctx.db
          .query("menu_items")
          .withIndex("by_category", (q) => q.eq("category_id", category_id))
          .collect()
      : await ctx.db.query("menu_items").collect();

    if (active_only) {
      items = items.filter((i) => i.is_active);
    }

    return items;
  },
});

export const listWithCategories = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .filter((q) => q.eq(q.field("is_active"), true))
      .collect();

    const items = await ctx.db
      .query("menu_items")
      .withIndex("by_active", (q) => q.eq("is_active", true))
      .collect();

    return categories.map((cat) => ({
      ...cat,
      items: items.filter((i) => i.category_id === cat._id),
    }));
  },
});

export const create = mutation({
  args: {
    category_id: v.id("menu_categories"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    is_veg: v.boolean(),
    has_inventory: v.boolean(),
    image_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("menu_items", {
      ...args,
      is_active: true,
    });

    if (args.has_inventory) {
      await ctx.db.insert("inventory_stock", {
        menu_item_id: id,
        quantity: 0,
        unit: "pcs",
        low_stock_threshold: 10,
      });
    }

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("menu_items"),
    category_id: v.optional(v.id("menu_categories")),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    is_veg: v.optional(v.boolean()),
    is_active: v.optional(v.boolean()),
    has_inventory: v.optional(v.boolean()),
    image_url: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const toggleActive = mutation({
  args: { id: v.id("menu_items") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item) throw new Error("Item not found");
    await ctx.db.patch(id, { is_active: !item.is_active });
  },
});

export const remove = mutation({
  args: { id: v.id("menu_items") },
  handler: async (ctx, { id }) => {
    // FIX [HIGH-7 Security]: Block hard-delete if active order_items reference this item
    const activeOrderItem = await ctx.db
      .query("order_items")
      .withIndex("by_order")
      .filter((q) => q.eq(q.field("menu_item_id"), id))
      .first();
    if (activeOrderItem) {
      // Soft-delete instead of hard-delete to preserve order history integrity
      await ctx.db.patch(id, { is_active: false });
      return;
    }
    const stock = await ctx.db
      .query("inventory_stock")
      .withIndex("by_menu_item", (q) => q.eq("menu_item_id", id))
      .first();
    if (stock) await ctx.db.delete(stock._id);
    await ctx.db.delete(id);
  },
});
