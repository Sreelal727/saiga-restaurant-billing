import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireHq } from "./lib/tenant";
import { Doc, Id } from "./_generated/dataModel";
import { QueryCtx } from "./_generated/server";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready", "served"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type OutletStats = {
  today_revenue: number; // settled/collected today
  today_unsettled: number; // value of still-open bills opened today
  today_total_income: number; // settled + unsettled today
  today_orders: number;
  active_orders: number;
  open_orders_value: number; // total value of all open (unsettled) bills
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

  // Collect the open (active) orders so we can value them, not just count.
  const activeOrders: Doc<"restaurant_orders">[] = [];
  for (const s of ACTIVE_STATUSES) {
    const rows = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet_status", (q) => q.eq("outlet_id", oid).eq("status", s))
      .collect();
    activeOrders.push(...rows);
  }

  const [tables, stocks] = await Promise.all([
    ctx.db.query("restaurant_tables").withIndex("by_outlet", (q) => q.eq("outlet_id", oid)).collect(),
    ctx.db.query("inventory_stock").withIndex("by_outlet", (q) => q.eq("outlet_id", oid)).collect(),
  ]);

  const todayPaid = allPaid.filter((o) => (o.paid_at ?? 0) >= todayTs);
  const today_revenue = round2(todayPaid.reduce((s, o) => s + o.total, 0));
  const open_orders_value = round2(activeOrders.reduce((s, o) => s + o.total, 0));
  const today_unsettled = round2(
    activeOrders
      .filter((o) => o._creationTime >= todayTs)
      .reduce((s, o) => s + o.total, 0)
  );

  return {
    stats: {
      today_revenue,
      today_unsettled,
      today_total_income: round2(today_revenue + today_unsettled),
      today_orders: todayPaid.length,
      active_orders: activeOrders.length,
      open_orders_value,
      occupied_tables: tables.filter((t) => t.status === "occupied").length,
      total_tables: tables.length,
      low_stock_count: stocks.filter((s) => s.quantity <= s.low_stock_threshold).length,
      total_revenue: round2(allPaid.reduce((s, o) => s + o.total, 0)),
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
  // outletId scopes the insights (totals, revenue bars, hourly, top products)
  // to one outlet; omit for company-wide. The per-outlet breakdown is always full.
  args: { token: v.string(), outletId: v.optional(v.id("outlets")) },
  handler: async (ctx, { token, outletId }) => {
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
    const allPaid: Doc<"restaurant_orders">[] = [];

    for (const o of outlets) {
      const { stats, paid } = await outletStats(ctx, o._id, todayTs);
      perOutlet.push({ outlet_id: o._id, name: o.name, ...stats });
      for (const order of paid) allPaid.push(order);
    }

    // Scope the insights to the chosen outlet (or all). The breakdown table
    // below always uses the full perOutlet list.
    const scopedOutlets = outletId
      ? perOutlet.filter((p) => p.outlet_id === outletId)
      : perOutlet;
    const scopedPaid = outletId
      ? allPaid.filter((o) => o.outlet_id === outletId)
      : allPaid;

    // Day-keyed revenue for the scoped set.
    const byDay: Record<string, number> = {};
    for (const order of scopedPaid) {
      if (!order.paid_at) continue;
      const d = new Date(order.paid_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDay[key] = (byDay[key] ?? 0) + order.total;
    }

    const totals: OutletStats = scopedOutlets.reduce(
      (acc, p) => ({
        today_revenue: acc.today_revenue + p.today_revenue,
        today_unsettled: acc.today_unsettled + p.today_unsettled,
        today_total_income: acc.today_total_income + p.today_total_income,
        today_orders: acc.today_orders + p.today_orders,
        active_orders: acc.active_orders + p.active_orders,
        open_orders_value: acc.open_orders_value + p.open_orders_value,
        occupied_tables: acc.occupied_tables + p.occupied_tables,
        total_tables: acc.total_tables + p.total_tables,
        low_stock_count: acc.low_stock_count + p.low_stock_count,
        total_revenue: acc.total_revenue + p.total_revenue,
      }),
      {
        today_revenue: 0,
        today_unsettled: 0,
        today_total_income: 0,
        today_orders: 0,
        active_orders: 0,
        open_orders_value: 0,
        occupied_tables: 0,
        total_tables: 0,
        low_stock_count: 0,
        total_revenue: 0,
      }
    );

    const DAY = 86_400_000;
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // ── Last 4 days revenue (zero-filled, chronological) — for the bar graph.
    const revenueLast4Days = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(todayTs - i * DAY);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      revenueLast4Days.push({
        date: key,
        label: `${WEEKDAYS[d.getDay()]} ${d.getDate()}`,
        revenue: byDay[key] ?? 0,
      });
    }

    // ── Recent window (30 days) for product ranking + peak-hour analysis.
    const WINDOW_DAYS = 30;
    const windowStart = todayTs - WINDOW_DAYS * DAY;
    const recentPaid = scopedPaid.filter((o) => (o.paid_at ?? 0) >= windowStart);

    // Peak hours — revenue + order count bucketed by hour of day (0–23).
    const hour12 = (h: number): string => {
      const period = h < 12 ? "AM" : "PM";
      const base = h % 12 === 0 ? 12 : h % 12;
      return `${base} ${period}`;
    };
    const hourRev = new Array(24).fill(0);
    const hourCount = new Array(24).fill(0);
    for (const o of recentPaid) {
      if (!o.paid_at) continue;
      const h = new Date(o.paid_at).getHours();
      hourRev[h] += o.total;
      hourCount[h] += 1;
    }
    const hourly = hourRev.map((revenue, hour) => ({
      hour,
      label: hour12(hour),
      revenue,
      orders: hourCount[hour],
    }));
    let peakIdx = -1;
    let peakRev = 0;
    hourRev.forEach((r, h) => {
      if (r > peakRev) {
        peakRev = r;
        peakIdx = h;
      }
    });
    const peakHour =
      peakIdx >= 0
        ? {
            hour: peakIdx,
            label: `${hour12(peakIdx)} – ${hour12((peakIdx + 1) % 24)}`,
            revenue: peakRev,
            orders: hourCount[peakIdx],
          }
        : null;

    // Top products by income (30-day window). Grouped by item name (portions
    // of the same dish roll up into one product).
    const itemLists = await Promise.all(
      recentPaid.map((o) =>
        ctx.db
          .query("order_items")
          .withIndex("by_order", (q) => q.eq("order_id", o._id))
          .collect()
      )
    );
    const prodMap = new Map<string, { name: string; revenue: number; qty: number }>();
    for (const items of itemLists) {
      for (const it of items) {
        const cur = prodMap.get(it.name) ?? { name: it.name, revenue: 0, qty: 0 };
        cur.revenue += it.price * it.quantity;
        cur.qty += it.quantity;
        prodMap.set(it.name, cur);
      }
    }
    const topProducts = [...prodMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Order-type mix (30-day window) — how revenue splits across dine-in,
    // takeaway and delivery. Free from recentPaid, no extra queries.
    const typeMap = new Map<string, { type: string; revenue: number; orders: number }>();
    for (const o of recentPaid) {
      const cur = typeMap.get(o.order_type) ?? { type: o.order_type, revenue: 0, orders: 0 };
      cur.revenue += o.total;
      cur.orders += 1;
      typeMap.set(o.order_type, cur);
    }
    const orderTypeMix = [...typeMap.values()]
      .map((t) => ({ ...t, revenue: round2(t.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);

    // Average settled bill value over the window.
    const windowRevenue = round2(recentPaid.reduce((s, o) => s + o.total, 0));
    const avgOrderValue = recentPaid.length > 0 ? round2(windowRevenue / recentPaid.length) : 0;

    return {
      outlets: perOutlet,
      totals,
      revenueLast4Days,
      hourly,
      peakHour,
      topProducts,
      orderTypeMix,
      avgOrderValue,
      windowDays: WINDOW_DAYS,
    };
  },
});
