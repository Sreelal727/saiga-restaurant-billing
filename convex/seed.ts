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
