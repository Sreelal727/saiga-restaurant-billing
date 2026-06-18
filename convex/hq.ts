import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireHq } from "./lib/tenant";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready", "served"] as const;

type OutletStats = {
  today_revenue: number;
  today_orders: number;
  active_orders: number;
  occupied_tables: number;
  total_tables: number;
  low_stock_count: number;
  total_revenue: number;
};

async function outletStats(
  ctx: QueryCtx,
  oid: Id<"outlets">,
  todayTs: number
): Promise<{ stats: OutletStats; paid: Doc<"restaurant_orders">[] }> {
  const allPaid = await ctx.db
    .query("restaurant_orders")
    .withIndex("by_outlet_status", (q) => q.eq("outlet_id", oid).eq("status", "paid"))
    .collect();

  let active = 0;
  for (const s of ACTIVE_STATUSES) {
    const rows = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet_status", (q) => q.eq("outlet_id", oid).eq("status", s))
      .collect();
    active += rows.length;
  }

  const [tables, stocks] = await Promise.all([
    ctx.db.query("restaurant_tables").withIndex("by_outlet", (q) => q.eq("outlet_id", oid)).collect(),
    ctx.db.query("inventory_stock").withIndex("by_outlet", (q) => q.eq("outlet_id", oid)).collect(),
  ]);

  const todayPaid = allPaid.filter((o) => (o.paid_at ?? 0) >= todayTs);

  return {
    stats: {
      today_revenue: todayPaid.reduce((s, o) => s + o.total, 0),
      today_orders: todayPaid.length,
      active_orders: active,
      occupied_tables: tables.filter((t) => t.status === "occupied").length,
      total_tables: tables.length,
      low_stock_count: stocks.filter((s) => s.quantity <= s.low_stock_threshold).length,
      total_revenue: allPaid.reduce((s, o) => s + o.total, 0),
    },
    paid: allPaid,
  };
}

/**
 * Consolidated cross-outlet overview — HQ / super admin only.
 * Returns company-wide totals, a per-outlet breakdown, and a combined
 * 14-day revenue trend.
 */
export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireHq(ctx, token);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    const outlets = (await ctx.db.query("outlets").collect())
      .filter((o) => o.is_active)
      .sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return a.name.localeCompare(b.name);
      });

    const perOutlet: Array<{ outlet_id: Id<"outlets">; name: string } & OutletStats> = [];
    const byDay: Record<string, number> = {};

    for (const o of outlets) {
      const { stats, paid } = await outletStats(ctx, o._id, todayTs);
      perOutlet.push({ outlet_id: o._id, name: o.name, ...stats });
      for (const order of paid) {
        if (!order.paid_at) continue;
        const d = new Date(order.paid_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        byDay[key] = (byDay[key] ?? 0) + order.total;
      }
    }

    const totals: OutletStats = perOutlet.reduce(
      (acc, p) => ({
        today_revenue: acc.today_revenue + p.today_revenue,
        today_orders: acc.today_orders + p.today_orders,
        active_orders: acc.active_orders + p.active_orders,
        occupied_tables: acc.occupied_tables + p.occupied_tables,
        total_tables: acc.total_tables + p.total_tables,
        low_stock_count: acc.low_stock_count + p.low_stock_count,
        total_revenue: acc.total_revenue + p.total_revenue,
      }),
      {
        today_revenue: 0,
        today_orders: 0,
        active_orders: 0,
        occupied_tables: 0,
        total_tables: 0,
        low_stock_count: 0,
        total_revenue: 0,
      }
    );

    const revenueByDay = Object.entries(byDay)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    return { outlets: perOutlet, totals, revenueByDay };
  },
});
