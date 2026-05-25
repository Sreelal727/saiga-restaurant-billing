import { mutation } from "./_generated/server";

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    // FIX [CRITICAL-1]: Block seed in production deployments
    if (process.env.NODE_ENV === "production") {
      throw new Error("Seed is not available in production");
    }

    // Clear existing data
    for (const table of [
      "restaurant_settings",
      "restaurant_tables",
      "menu_categories",
      "menu_items",
      "inventory_stock",
      "restaurant_staff",
      "restaurant_orders",
      "order_items",
      "counters",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    }

    // Settings
    await ctx.db.insert("restaurant_settings", {
      restaurant_name: "Saiga Restaurant",
      address: "12 MG Road, Bengaluru, Karnataka",
      phone: "+91 98765 43210",
      cgst_rate: 2.5,
      sgst_rate: 2.5,
      default_packing_charge: 30,
      default_delivery_charge: 50,
      currency: "₹",
    });

    // Tables
    const tableData = [
      { table_number: "T1", capacity: 2 },
      { table_number: "T2", capacity: 4 },
      { table_number: "T3", capacity: 4 },
      { table_number: "T4", capacity: 6 },
      { table_number: "T5", capacity: 6 },
      { table_number: "T6", capacity: 8 },
      { table_number: "BAR-1", capacity: 2 },
      { table_number: "BAR-2", capacity: 2 },
    ];
    for (const t of tableData) {
      await ctx.db.insert("restaurant_tables", { ...t, status: "available" });
    }

    // Categories
    const catStarters = await ctx.db.insert("menu_categories", { name: "Starters", display_order: 1, is_active: true });
    const catMain = await ctx.db.insert("menu_categories", { name: "Main Course", display_order: 2, is_active: true });
    const catBreads = await ctx.db.insert("menu_categories", { name: "Breads", display_order: 3, is_active: true });
    const catDrinks = await ctx.db.insert("menu_categories", { name: "Beverages", display_order: 4, is_active: true });
    const catDesserts = await ctx.db.insert("menu_categories", { name: "Desserts", display_order: 5, is_active: true });

    // Menu items — FIX [Code-Finding-12]: use deterministic quantities instead of Math.random()
    const menuItems: Array<{
      category_id: typeof catStarters;
      name: string;
      price: number;
      is_veg: boolean;
      has_inventory: boolean;
      description?: string;
      seed_qty?: number;
    }> = [
      { category_id: catStarters, name: "Paneer Tikka", price: 280, is_veg: true, has_inventory: true, description: "Cottage cheese marinated in spices", seed_qty: 25 },
      { category_id: catStarters, name: "Chicken 65", price: 320, is_veg: false, has_inventory: true, description: "Spicy deep-fried chicken", seed_qty: 30 },
      { category_id: catStarters, name: "Veg Spring Roll", price: 180, is_veg: true, has_inventory: false },
      { category_id: catStarters, name: "Fish Fry", price: 350, is_veg: false, has_inventory: true, seed_qty: 20 },
      { category_id: catMain, name: "Dal Makhani", price: 260, is_veg: true, has_inventory: true, description: "Slow-cooked black lentils", seed_qty: 40 },
      { category_id: catMain, name: "Butter Chicken", price: 380, is_veg: false, has_inventory: true, description: "Tender chicken in tomato-butter gravy", seed_qty: 35 },
      { category_id: catMain, name: "Paneer Butter Masala", price: 300, is_veg: true, has_inventory: true, seed_qty: 30 },
      { category_id: catMain, name: "Chicken Biryani", price: 420, is_veg: false, has_inventory: true, description: "Fragrant basmati rice with chicken", seed_qty: 25 },
      { category_id: catMain, name: "Veg Biryani", price: 300, is_veg: true, has_inventory: true, seed_qty: 30 },
      { category_id: catBreads, name: "Butter Naan", price: 60, is_veg: true, has_inventory: false },
      { category_id: catBreads, name: "Garlic Naan", price: 80, is_veg: true, has_inventory: false },
      { category_id: catBreads, name: "Tandoori Roti", price: 40, is_veg: true, has_inventory: false },
      { category_id: catDrinks, name: "Mango Lassi", price: 120, is_veg: true, has_inventory: true, seed_qty: 50 },
      { category_id: catDrinks, name: "Masala Chai", price: 60, is_veg: true, has_inventory: false },
      { category_id: catDrinks, name: "Fresh Lime Soda", price: 80, is_veg: true, has_inventory: false },
      { category_id: catDrinks, name: "Soft Drink", price: 60, is_veg: true, has_inventory: true, seed_qty: 60 },
      { category_id: catDesserts, name: "Gulab Jamun", price: 120, is_veg: true, has_inventory: true, seed_qty: 40 },
      { category_id: catDesserts, name: "Kulfi", price: 100, is_veg: true, has_inventory: true, seed_qty: 35 },
      { category_id: catDesserts, name: "Ras Malai", price: 140, is_veg: true, has_inventory: true, seed_qty: 30 },
    ];

    for (const item of menuItems) {
      const { seed_qty, ...itemData } = item;
      const id = await ctx.db.insert("menu_items", { ...itemData, is_active: true });
      if (itemData.has_inventory && seed_qty !== undefined) {
        await ctx.db.insert("inventory_stock", {
          menu_item_id: id,
          quantity: seed_qty,
          unit: "pcs",
          low_stock_threshold: 10,
          last_restocked_at: Date.now() - 86400000,
        });
      }
    }

    // Staff
    const staffData = [
      { name: "Ravi Kumar", role: "manager" as const, phone: "+91 99001 11111" },
      { name: "Priya Sharma", role: "waiter" as const, phone: "+91 99002 22222" },
      { name: "Arjun Singh", role: "waiter" as const, phone: "+91 99003 33333" },
      { name: "Meena Patel", role: "cashier" as const, phone: "+91 99004 44444" },
      { name: "Karthik R", role: "waiter" as const, phone: "+91 99005 55555" },
    ];
    for (const s of staffData) {
      await ctx.db.insert("restaurant_staff", { ...s, is_active: true });
    }

    return { success: true, message: "Seed data created successfully" };
  },
});
