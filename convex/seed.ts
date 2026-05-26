import { mutation } from "./_generated/server";

export const run = mutation({
  args: {},
  handler: async (ctx) => {
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
      { table_number: "T7", capacity: 4 },
      { table_number: "T8", capacity: 2 },
      { table_number: "BAR-1", capacity: 2 },
      { table_number: "BAR-2", capacity: 2 },
      { table_number: "BAR-3", capacity: 3 },
      { table_number: "PATIO-1", capacity: 6 },
    ];
    for (const t of tableData) {
      await ctx.db.insert("restaurant_tables", { ...t, status: "available" });
    }

    // Categories
    const catStarters = await ctx.db.insert("menu_categories", { name: "Starters", display_order: 1, is_active: true });
    const catMain = await ctx.db.insert("menu_categories", { name: "Main Course", display_order: 2, is_active: true });
    const catRice = await ctx.db.insert("menu_categories", { name: "Rice & Noodles", display_order: 3, is_active: true });
    const catBreads = await ctx.db.insert("menu_categories", { name: "Breads", display_order: 4, is_active: true });
    const catDrinks = await ctx.db.insert("menu_categories", { name: "Beverages", display_order: 5, is_active: true });
    const catDesserts = await ctx.db.insert("menu_categories", { name: "Desserts", display_order: 6, is_active: true });

    type CategoryId = typeof catStarters;
    const menuItems: Array<{
      category_id: CategoryId;
      name: string;
      price: number;
      is_veg: boolean;
      has_inventory: boolean;
      description?: string;
      seed_qty?: number;
    }> = [
      // Starters
      { category_id: catStarters, name: "Paneer Tikka", price: 280, is_veg: true, has_inventory: true, description: "Cottage cheese marinated in spices, grilled in tandoor", seed_qty: 25 },
      { category_id: catStarters, name: "Hara Bhara Kabab", price: 220, is_veg: true, has_inventory: true, description: "Spinach & pea patties with mint chutney", seed_qty: 30 },
      { category_id: catStarters, name: "Veg Spring Roll", price: 180, is_veg: true, has_inventory: false, description: "Crispy rolls stuffed with seasoned vegetables" },
      { category_id: catStarters, name: "Stuffed Mushrooms", price: 260, is_veg: true, has_inventory: true, description: "Button mushrooms stuffed with cheese & herbs", seed_qty: 20 },
      { category_id: catStarters, name: "Chicken 65", price: 320, is_veg: false, has_inventory: true, description: "Spicy deep-fried chicken with curry leaves", seed_qty: 30 },
      { category_id: catStarters, name: "Mutton Seekh Kebab", price: 380, is_veg: false, has_inventory: true, description: "Minced mutton skewers with aromatic spices", seed_qty: 15 },
      { category_id: catStarters, name: "Fish Fry", price: 350, is_veg: false, has_inventory: true, description: "Crispy fried fish with Goan masala", seed_qty: 20 },
      { category_id: catStarters, name: "Prawn Koliwada", price: 420, is_veg: false, has_inventory: true, description: "Batter-fried prawns with coastal spices", seed_qty: 15 },
      { category_id: catStarters, name: "Chicken Tikka", price: 340, is_veg: false, has_inventory: true, description: "Boneless chicken marinated in yogurt & spices", seed_qty: 25 },

      // Main Course
      { category_id: catMain, name: "Dal Makhani", price: 260, is_veg: true, has_inventory: true, description: "Slow-cooked black lentils in creamy tomato gravy", seed_qty: 40 },
      { category_id: catMain, name: "Palak Paneer", price: 280, is_veg: true, has_inventory: true, description: "Cottage cheese in smooth spinach gravy", seed_qty: 30 },
      { category_id: catMain, name: "Paneer Butter Masala", price: 300, is_veg: true, has_inventory: true, description: "Paneer in rich tomato-butter gravy", seed_qty: 30 },
      { category_id: catMain, name: "Chole Bhature", price: 220, is_veg: true, has_inventory: true, description: "Spiced chickpeas served with fluffy fried bread", seed_qty: 25 },
      { category_id: catMain, name: "Mixed Veg Curry", price: 240, is_veg: true, has_inventory: false, description: "Seasonal vegetables in aromatic curry sauce" },
      { category_id: catMain, name: "Butter Chicken", price: 380, is_veg: false, has_inventory: true, description: "Tender chicken in velvety tomato-butter gravy", seed_qty: 35 },
      { category_id: catMain, name: "Rogan Josh", price: 420, is_veg: false, has_inventory: true, description: "Slow-braised lamb in Kashmiri spice gravy", seed_qty: 20 },
      { category_id: catMain, name: "Lamb Korma", price: 440, is_veg: false, has_inventory: true, description: "Tender lamb in mild cashew & cream sauce", seed_qty: 15 },
      { category_id: catMain, name: "Goan Fish Curry", price: 400, is_veg: false, has_inventory: true, description: "Tangy coconut-based fish curry", seed_qty: 20 },
      { category_id: catMain, name: "Chicken Chettinad", price: 360, is_veg: false, has_inventory: true, description: "Fiery South Indian chicken curry", seed_qty: 25 },

      // Rice & Noodles
      { category_id: catRice, name: "Steamed Rice", price: 80, is_veg: true, has_inventory: false },
      { category_id: catRice, name: "Jeera Rice", price: 120, is_veg: true, has_inventory: false, description: "Basmati rice tempered with cumin" },
      { category_id: catRice, name: "Chicken Biryani", price: 420, is_veg: false, has_inventory: true, description: "Fragrant basmati rice layered with spiced chicken", seed_qty: 25 },
      { category_id: catRice, name: "Veg Biryani", price: 300, is_veg: true, has_inventory: true, description: "Aromatic basmati rice with fresh vegetables", seed_qty: 30 },
      { category_id: catRice, name: "Mutton Biryani", price: 480, is_veg: false, has_inventory: true, description: "Slow-cooked biryani with tender mutton", seed_qty: 15 },
      { category_id: catRice, name: "Egg Fried Rice", price: 200, is_veg: false, has_inventory: false, description: "Wok-tossed rice with eggs and vegetables" },
      { category_id: catRice, name: "Veg Hakka Noodles", price: 200, is_veg: true, has_inventory: false, description: "Indo-Chinese stir-fried noodles" },

      // Breads
      { category_id: catBreads, name: "Butter Naan", price: 60, is_veg: true, has_inventory: false },
      { category_id: catBreads, name: "Garlic Naan", price: 80, is_veg: true, has_inventory: false },
      { category_id: catBreads, name: "Cheese Naan", price: 100, is_veg: true, has_inventory: false, description: "Naan stuffed with melted cheese" },
      { category_id: catBreads, name: "Tandoori Roti", price: 40, is_veg: true, has_inventory: false },
      { category_id: catBreads, name: "Lachha Paratha", price: 70, is_veg: true, has_inventory: false, description: "Layered whole-wheat flatbread" },
      { category_id: catBreads, name: "Missi Roti", price: 50, is_veg: true, has_inventory: false, description: "Spiced gram-flour flatbread" },

      // Beverages
      { category_id: catDrinks, name: "Mango Lassi", price: 120, is_veg: true, has_inventory: true, description: "Chilled yogurt drink with Alphonso mango", seed_qty: 50 },
      { category_id: catDrinks, name: "Masala Chai", price: 60, is_veg: true, has_inventory: false, description: "Spiced milk tea with ginger & cardamom" },
      { category_id: catDrinks, name: "Cold Coffee", price: 140, is_veg: true, has_inventory: true, description: "Blended coffee with ice cream", seed_qty: 30 },
      { category_id: catDrinks, name: "Fresh Lime Soda", price: 80, is_veg: true, has_inventory: false },
      { category_id: catDrinks, name: "Tender Coconut Water", price: 100, is_veg: true, has_inventory: true, seed_qty: 20 },
      { category_id: catDrinks, name: "Rose Sharbat", price: 80, is_veg: true, has_inventory: false, description: "Chilled rose syrup drink with basil seeds" },
      { category_id: catDrinks, name: "Soft Drink", price: 60, is_veg: true, has_inventory: true, seed_qty: 60 },
      { category_id: catDrinks, name: "Mineral Water", price: 30, is_veg: true, has_inventory: true, seed_qty: 100 },

      // Desserts
      { category_id: catDesserts, name: "Gulab Jamun", price: 120, is_veg: true, has_inventory: true, description: "Soft milk-solid dumplings in rose syrup", seed_qty: 40 },
      { category_id: catDesserts, name: "Kulfi", price: 100, is_veg: true, has_inventory: true, description: "Traditional Indian ice cream (pistachio/mango)", seed_qty: 35 },
      { category_id: catDesserts, name: "Ras Malai", price: 140, is_veg: true, has_inventory: true, description: "Soft cheese patties in saffron-cardamom cream", seed_qty: 30 },
      { category_id: catDesserts, name: "Gajar Halwa", price: 130, is_veg: true, has_inventory: true, description: "Slow-cooked carrot pudding with khoa", seed_qty: 25 },
      { category_id: catDesserts, name: "Kheer", price: 110, is_veg: true, has_inventory: true, description: "Creamy rice pudding with cardamom & nuts", seed_qty: 30 },
      { category_id: catDesserts, name: "Brownie with Ice Cream", price: 180, is_veg: true, has_inventory: true, description: "Warm chocolate brownie with vanilla scoop", seed_qty: 20 },
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
      { name: "Divya Nair", role: "waiter" as const, phone: "+91 99006 66666" },
      { name: "Suresh Babu", role: "cashier" as const, phone: "+91 99007 77777" },
    ];
    for (const s of staffData) {
      await ctx.db.insert("restaurant_staff", { ...s, is_active: true });
    }

    return { success: true, message: "Seed data created successfully" };
  },
});
