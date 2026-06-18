import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet } from "./lib/tenant";

export const stats = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    // Outlet-scoped indexes only — no global table scans.
    const [todayPaid, activeOrders, tables, stocks] = await Promise.all([
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_paid_at", (q) =>
          q.eq("outlet_id", oid).gte("paid_at", todayTs)
        )
        .collect(),
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "pending")
        )
        .collect()
        .then(async (pending) => {
          const [confirmed, preparing, ready, served] = await Promise.all([
            ctx.db
              .query("restaurant_orders")
              .withIndex("by_outlet_status", (q) =>
                q.eq("outlet_id", oid).eq("status", "confirmed")
              )
              .collect(),
            ctx.db
              .query("restaurant_orders")
              .withIndex("by_outlet_status", (q) =>
                q.eq("outlet_id", oid).eq("status", "preparing")
              )
              .collect(),
            ctx.db
              .query("restaurant_orders")
              .withIndex("by_outlet_status", (q) =>
                q.eq("outlet_id", oid).eq("status", "ready")
              )
              .collect(),
            ctx.db
              .query("restaurant_orders")
              .withIndex("by_outlet_status", (q) =>
                q.eq("outlet_id", oid).eq("status", "served")
              )
              .collect(),
          ]);
          return (
            pending.length +
            confirmed.length +
            preparing.length +
            ready.length +
            served.length
          );
        }),
      ctx.db
        .query("restaurant_tables")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect(),
      ctx.db
        .query("inventory_stock")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect(),
    ]);

    const todayRevenue = todayPaid.reduce((s, o) => s + o.total, 0);
    const occupiedTables = tables.filter((t) => t.status === "occupied").length;
    const lowStockCount = stocks.filter(
      (s) => s.quantity <= s.low_stock_threshold
    ).length;

    // Total revenue from all paid orders, scoped to this outlet.
    const allPaid = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet_status", (q) =>
        q.eq("outlet_id", oid).eq("status", "paid")
      )
      .collect();
    const totalRevenue = allPaid.reduce((s, o) => s + o.total, 0);

    return {
      today_revenue: todayRevenue,
      total_revenue: totalRevenue,
      today_orders: todayPaid.length,
      active_orders: activeOrders,
      occupied_tables: occupiedTables,
      total_tables: tables.length,
      low_stock_count: lowStockCount,
    };
  },
});

export const recentOrders = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const orders = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .order("desc")
      .take(10);

    return Promise.all(
      orders.map(async (o) => {
        const [table, waiter, items] = await Promise.all([
          o.table_id ? ctx.db.get(o.table_id) : null,
          o.waiter_id ? ctx.db.get(o.waiter_id) : null,
          ctx.db
            .query("order_items")
            .withIndex("by_order", (q) => q.eq("order_id", o._id))
            .collect(),
        ]);
        return { ...o, table, waiter, items };
      })
    );
  },
});

export const revenueByDay = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const paid = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet_status", (q) =>
        q.eq("outlet_id", oid).eq("status", "paid")
      )
      .collect();

    const byDay: Record<string, number> = {};
    for (const order of paid) {
      if (!order.paid_at) continue;
      const d = new Date(order.paid_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDay[key] = (byDay[key] ?? 0) + order.total;
    }

    return Object.entries(byDay)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
  },
});

/** All tables with their current order (for the floor map). */
export const liveTables = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const tables = await ctx.db
      .query("restaurant_tables")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();

    const enriched = await Promise.all(
      tables.map(async (t) => {
        const current_order = t.current_order_id
          ? await ctx.db.get(t.current_order_id)
          : null;
        return { ...t, current_order };
      })
    );

    // Sort numerically by table_number so T1, T2, T10 sorts correctly
    return enriched.sort((a, b) =>
      a.table_number.localeCompare(b.table_number, undefined, { numeric: true })
    );
  },
});

/** Up to 20 non-paid, non-cancelled active orders for the live feed. */
export const activeOrders = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const [pending, confirmed, preparing, ready, served] = await Promise.all([
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "pending")
        )
        .order("desc")
        .take(10),
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "confirmed")
        )
        .order("desc")
        .take(10),
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "preparing")
        )
        .order("desc")
        .take(10),
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "ready")
        )
        .order("desc")
        .take(10),
      ctx.db
        .query("restaurant_orders")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "served")
        )
        .order("desc")
        .take(10),
    ]);

    const all = [...pending, ...confirmed, ...preparing, ...ready, ...served]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 20);

    return Promise.all(
      all.map(async (o) => {
        const [table, waiter] = await Promise.all([
          o.table_id ? ctx.db.get(o.table_id) : null,
          o.waiter_id ? ctx.db.get(o.waiter_id) : null,
        ]);
        return { ...o, table, waiter };
      })
    );
  },
});
