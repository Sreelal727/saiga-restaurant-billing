import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet } from "./lib/tenant";

/**
 * Sales report for a given date range, scoped to a single outlet.
 * Uses the by_outlet_paid_at index so only this outlet's paid orders with a
 * paid_at timestamp are scanned.
 */
export const gstReport = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    from: v.number(), // start timestamp inclusive (ms)
    to: v.number(),   // end timestamp exclusive (ms)
  },
  handler: async (ctx, { token, outletId, from, to }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const rows = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet_paid_at", (q) =>
        q.eq("outlet_id", oid).gte("paid_at", from).lt("paid_at", to)
      )
      .collect();

    // Index only covers docs where paid_at is set; guard on status just in case
    const paidOrders = rows.filter((o) => o.status === "paid");

    const paymentBreakdown: Record<string, { count: number; amount: number }> = {};
    let total_revenue = 0;
    let total_discount = 0;
    let total_subtotal = 0;

    for (const order of paidOrders) {
      total_revenue += order.total;
      total_discount += order.discount_amount;
      total_subtotal += order.subtotal;
    }

    // Payment-method breakdown sourced from order_payments so split-bill
    // orders show up against each method that paid for them. Scoped to this
    // outlet via the by_outlet_paid_at index.
    const payments = await ctx.db
      .query("order_payments")
      .withIndex("by_outlet_paid_at", (q) =>
        q.eq("outlet_id", oid).gte("paid_at", from).lt("paid_at", to)
      )
      .collect();
    for (const p of payments) {
      if (!paymentBreakdown[p.method]) {
        paymentBreakdown[p.method] = { count: 0, amount: 0 };
      }
      paymentBreakdown[p.method].count += 1;
      paymentBreakdown[p.method].amount += p.amount;
    }

    return {
      total_orders: paidOrders.length,
      total_subtotal,
      total_discount,
      total_revenue,
      payment_breakdown: paymentBreakdown,
      orders: paidOrders
        .sort((a, b) => (b.paid_at ?? 0) - (a.paid_at ?? 0))
        .map((o) => ({
          _id: o._id,
          order_number: o.order_number,
          order_type: o.order_type,
          paid_at: o.paid_at,
          payment_method: o.payment_method,
          subtotal: o.subtotal,
          discount_amount: o.discount_amount,
          total: o.total,
        })),
    };
  },
});
