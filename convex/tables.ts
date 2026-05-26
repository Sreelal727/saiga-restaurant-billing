import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("restaurant_tables").collect();
  },
});

export const listWithCurrentOrder = query({
  args: {},
  handler: async (ctx) => {
    const tables = await ctx.db.query("restaurant_tables").collect();
    return Promise.all(
      tables.map(async (table) => {
        if (!table.current_order_id) return { ...table, currentOrder: null };
        const order = await ctx.db.get(table.current_order_id);
        if (!order) return { ...table, currentOrder: null };
        const items = await ctx.db
          .query("order_items")
          .withIndex("by_order", (q) => q.eq("order_id", order._id))
          .collect();
        return {
          ...table,
          currentOrder: {
            _id: order._id,
            order_number: order.order_number,
            status: order.status,
            total: order.total,
            customer_name: order.customer_name ?? null,
            item_count: items.reduce((s, i) => s + i.quantity, 0),
          },
        };
      })
    );
  },
});

export const create = mutation({
  args: {
    table_number: v.string(),
    capacity: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("restaurant_tables", {
      table_number: args.table_number,
      capacity: args.capacity,
      status: "available",
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("restaurant_tables"),
    status: v.union(
      v.literal("available"),
      v.literal("occupied"),
      v.literal("reserved")
    ),
    current_order_id: v.optional(v.id("restaurant_orders")),
  },
  handler: async (ctx, { id, status, current_order_id }) => {
    await ctx.db.patch(id, { status, current_order_id });
  },
});

export const remove = mutation({
  args: { id: v.id("restaurant_tables") },
  handler: async (ctx, { id }) => {
    // FIX [HIGH-6 Security]: Block deletion of tables with active orders
    const table = await ctx.db.get(id);
    if (!table) throw new Error("Table not found");
    if (table.current_order_id) {
      throw new Error("Cannot delete a table with an active order in progress");
    }
    await ctx.db.delete(id);
  },
});
