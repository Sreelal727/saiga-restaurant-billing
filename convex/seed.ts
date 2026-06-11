/**
 * Database housekeeping. The original Saiga demo seed is gone — real menu
 * categories, items, and staff are entered via the admin UI.
 *
 * `clearMenuAndStaff` is kept as a one-shot reset tool: it removes every
 * menu_category, menu_item, inventory_stock row, and restaurant_staff row,
 * but leaves settings, tables, orders, payments, customers, and reservations
 * untouched. Useful when the deployment was seeded with demo content and
 * the operator wants a blank slate before entering their own data.
 *
 * Invoke from the CLI:
 *
 *   npx convex run seed:clearMenuAndStaff --prod
 */

import { mutation } from "./_generated/server";

export const clearMenuAndStaff = mutation({
  args: {},
  handler: async (ctx) => {
    const stocks = await ctx.db.query("inventory_stock").collect();
    for (const row of stocks) await ctx.db.delete(row._id);

    const items = await ctx.db.query("menu_items").collect();
    for (const row of items) await ctx.db.delete(row._id);

    const categories = await ctx.db.query("menu_categories").collect();
    for (const row of categories) await ctx.db.delete(row._id);

    const staff = await ctx.db.query("restaurant_staff").collect();
    for (const row of staff) await ctx.db.delete(row._id);

    return {
      cleared: {
        inventory_stock: stocks.length,
        menu_items: items.length,
        menu_categories: categories.length,
        restaurant_staff: staff.length,
      },
    };
  },
});

/**
 * Wipe every transactional row — orders, line items, payments, KOTs,
 * waiter calls, reservations — and reset the order-number counter so the
 * next order starts at ORD-00001. Also flips every restaurant_table back
 * to `available` and clears any dangling `current_order_id`.
 *
 * Preserves: settings, tables themselves, customers, menu_items/categories,
 * inventory_stock, restaurant_staff, mobile_sessions, login_attempts,
 * inventory_dumps.
 *
 *   npx convex run seed:clearTransactions --prod
 */
export const clearTransactions = mutation({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("restaurant_orders").collect();
    for (const row of orders) await ctx.db.delete(row._id);

    const orderItems = await ctx.db.query("order_items").collect();
    for (const row of orderItems) await ctx.db.delete(row._id);

    const payments = await ctx.db.query("order_payments").collect();
    for (const row of payments) await ctx.db.delete(row._id);

    const reservations = await ctx.db.query("restaurant_reservations").collect();
    for (const row of reservations) await ctx.db.delete(row._id);

    const waiterCalls = await ctx.db.query("waiter_calls").collect();
    for (const row of waiterCalls) await ctx.db.delete(row._id);

    // Reset the order-number counter and any other transient counters.
    const counters = await ctx.db.query("counters").collect();
    for (const row of counters) await ctx.db.delete(row._id);

    // Self-order rate-limit buckets are transient; safe to drop.
    const rateLimits = await ctx.db.query("self_order_rate_limits").collect();
    for (const row of rateLimits) await ctx.db.delete(row._id);

    // Any table left "occupied" or "reserved" from a now-deleted order
    // becomes "available" with no current_order_id.
    const tables = await ctx.db.query("restaurant_tables").collect();
    let tablesReset = 0;
    for (const t of tables) {
      if (t.status !== "available" || t.current_order_id !== undefined) {
        await ctx.db.patch(t._id, {
          status: "available",
          current_order_id: undefined,
        });
        tablesReset += 1;
      }
    }

    return {
      cleared: {
        restaurant_orders: orders.length,
        order_items: orderItems.length,
        order_payments: payments.length,
        restaurant_reservations: reservations.length,
        waiter_calls: waiterCalls.length,
        counters: counters.length,
        self_order_rate_limits: rateLimits.length,
        tables_reset_to_available: tablesReset,
      },
    };
  },
});
