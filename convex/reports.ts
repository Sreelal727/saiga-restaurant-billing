import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * GST report for a given date range.
 * Uses the by_paid_at index so only paid orders with a paid_at timestamp are scanned.
 */
export const gstReport = query({
  args: {
    from: v.number(), // start timestamp inclusive (ms)
    to: v.number(),   // end timestamp exclusive (ms)
  },
  handler: async (ctx, { from, to }) => {
    const rows = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_paid_at", (q) => q.gte("paid_at", from).lt("paid_at", to))
      .collect();

    // Index only covers docs where paid_at is set; guard on status just in case
    const paidOrders = rows.filter((o) => o.status === "paid");

    const paymentBreakdown: Record<string, { count: number; amount: number }> = {};
    let total_revenue = 0;
    let total_cgst = 0;
    let total_sgst = 0;
    let total_discount = 0;
    let total_subtotal = 0;

    for (const order of paidOrders) {
      total_revenue += order.total;
      total_cgst += order.cgst_amount;
      total_sgst += order.sgst_amount;
      total_discount += order.discount_amount;
      total_subtotal += order.subtotal;
    }

    // Payment-method breakdown sourced from order_payments so split-bill
    // orders show up against each method that paid for them.
    const payments = await ctx.db
      .query("order_payments")
      .withIndex("by_paid_at", (q) => q.gte("paid_at", from).lt("paid_at", to))
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
      total_cgst,
      total_sgst,
      total_tax: total_cgst + total_sgst,
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
          cgst_rate: o.cgst_rate,
          sgst_rate: o.sgst_rate,
          cgst_amount: o.cgst_amount,
          sgst_amount: o.sgst_amount,
          total: o.total,
        })),
    };
  },
});
