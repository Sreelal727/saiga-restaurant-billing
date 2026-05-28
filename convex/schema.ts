import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  restaurant_settings: defineTable({
    restaurant_name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    default_packing_charge: v.number(),
    default_delivery_charge: v.number(),
    currency: v.string(),
  }),

  restaurant_tables: defineTable({
    table_number: v.string(),
    capacity: v.number(),
    status: v.union(
      v.literal("available"),
      v.literal("occupied"),
      v.literal("reserved")
    ),
    current_order_id: v.optional(v.id("restaurant_orders")),
  }).index("by_status", ["status"]),

  menu_categories: defineTable({
    name: v.string(),
    display_order: v.number(),
    is_active: v.boolean(),
  }).index("by_display_order", ["display_order"]),

  menu_items: defineTable({
    category_id: v.id("menu_categories"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    is_veg: v.boolean(),
    is_active: v.boolean(),
    has_inventory: v.boolean(),
    image_url: v.optional(v.string()),
    image_storage_id: v.optional(v.id("_storage")),
  })
    .index("by_category", ["category_id"])
    .index("by_active", ["is_active"]),

  inventory_stock: defineTable({
    menu_item_id: v.id("menu_items"),
    quantity: v.number(),
    unit: v.string(),
    low_stock_threshold: v.number(),
    last_restocked_at: v.optional(v.number()),
  }).index("by_menu_item", ["menu_item_id"]),

  restaurant_staff: defineTable({
    name: v.string(),
    role: v.union(v.literal("waiter"), v.literal("manager"), v.literal("cashier")),
    phone: v.optional(v.string()),
    is_active: v.boolean(),
    // Login credentials for non-admin staff — username (lowercased, unique)
    // and a 4-digit PIN. Admin signs in with hardcoded ADMIN_PASSWORD env var.
    username: v.optional(v.string()),
    pin: v.optional(v.string()),
  })
    .index("by_role", ["role"])
    .index("by_username", ["username"]),

  restaurant_customers: defineTable({
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    default_address: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_phone", ["phone"]),

  restaurant_orders: defineTable({
    order_number: v.string(),
    order_type: v.union(
      v.literal("dine_in"),
      v.literal("takeaway"),
      v.literal("delivery")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("served"),
      v.literal("paid"),
      v.literal("cancelled")
    ),
    table_id: v.optional(v.id("restaurant_tables")),
    waiter_id: v.optional(v.id("restaurant_staff")),
    customer_id: v.optional(v.id("restaurant_customers")),
    customer_name: v.optional(v.string()),
    customer_phone: v.optional(v.string()),
    delivery_address: v.optional(v.string()),
    subtotal: v.number(),
    discount_percent: v.number(),
    discount_amount: v.number(),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    cgst_amount: v.number(),
    sgst_amount: v.number(),
    tips: v.number(),
    packing_charge: v.number(),
    delivery_charge: v.number(),
    total: v.number(),
    payment_method: v.optional(
      v.union(v.literal("cash"), v.literal("card"), v.literal("upi"))
    ),
    paid_at: v.optional(v.number()),
    notes: v.optional(v.string()),
    kot_count: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_order_number", ["order_number"])
    .index("by_paid_at", ["paid_at"]),

  order_items: defineTable({
    order_id: v.id("restaurant_orders"),
    menu_item_id: v.id("menu_items"),
    name: v.string(),
    price: v.number(),
    quantity: v.number(),
    notes: v.optional(v.string()),
    kot_batch: v.optional(v.number()), // null until printed; 1, 2, … when sent to kitchen
  }).index("by_order", ["order_id"]),

  restaurant_reservations: defineTable({
    table_id: v.id("restaurant_tables"),
    customer_id: v.optional(v.id("restaurant_customers")),
    customer_name: v.string(),
    customer_phone: v.string(),
    party_size: v.number(),
    scheduled_at: v.number(),       // start timestamp (ms)
    duration_minutes: v.number(),   // expected stay
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("seated"),
      v.literal("cancelled"),
      v.literal("no_show")
    ),
    notes: v.optional(v.string()),
    seated_order_id: v.optional(v.id("restaurant_orders")),
  })
    .index("by_table", ["table_id"])
    .index("by_scheduled_at", ["scheduled_at"])
    .index("by_status", ["status"]),

  order_payments: defineTable({
    order_id: v.id("restaurant_orders"),
    amount: v.number(),
    method: v.union(
      v.literal("cash"),
      v.literal("card"),
      v.literal("upi"),
      v.literal("online")
    ),
    paid_at: v.number(),
    payer_name: v.optional(v.string()),
    customer_id: v.optional(v.id("restaurant_customers")),
  })
    .index("by_order", ["order_id"])
    .index("by_paid_at", ["paid_at"]),

  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),
});
