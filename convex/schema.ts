import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Multi-tenancy: each outlet is one branch/restaurant of the company ──
  // Tenant-scoped tables carry an optional outlet_id (optional during the
  // additive migration; enforced once every row is backfilled).
  outlets: defineTable({
    name: v.string(),
    slug: v.string(),
    is_active: v.boolean(),
    is_default: v.optional(v.boolean()), // the original "JABAL MANDI" outlet
    created_at: v.number(),
    // Outlet login (manager of this outlet). password_hash = sha256(password).
    username: v.optional(v.string()),
    password_hash: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_username", ["username"]),

  restaurant_settings: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    restaurant_name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    default_packing_charge: v.number(),
    default_delivery_charge: v.number(),
    currency: v.string(),
    // Thermal receipt roll width in mm (58 or 80). Missing == 80.
    bill_paper_width: v.optional(v.number()),
  }).index("by_outlet", ["outlet_id"]),

  restaurant_tables: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    table_number: v.string(),
    capacity: v.number(),
    status: v.union(
      v.literal("available"),
      v.literal("occupied"),
      v.literal("reserved")
    ),
    current_order_id: v.optional(v.id("restaurant_orders")),
    // Opaque token used by customer QR portal so URLs don't leak internal ids.
    // Missing on legacy rows; minted on demand from the admin Tables page.
    qr_token: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_qr_token", ["qr_token"])
    .index("by_outlet", ["outlet_id"]),

  menu_categories: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    name: v.string(),
    display_order: v.number(),
    is_active: v.boolean(),
  })
    .index("by_display_order", ["display_order"])
    .index("by_outlet", ["outlet_id"]),

  menu_items: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    category_id: v.id("menu_categories"),
    name: v.string(),
    description: v.optional(v.string()),
    // Base price. For items sold in portions this mirrors the cheapest
    // portion (so legacy "from ₹X" reads stay correct); the authoritative
    // per-portion prices live in `variants`.
    price: v.number(),
    // Optional portion/size pricing (e.g. Quarter / Half / Full). When present
    // and non-empty, the item is ordered by portion. `unit_factor` is how much
    // stock one portion consumes (Quarter = 0.25, Half = 0.5, Full = 1).
    variants: v.optional(
      v.array(
        v.object({
          label: v.string(),
          price: v.number(),
          unit_factor: v.optional(v.number()),
        })
      )
    ),
    // "As per size" / market-price items have no fixed menu price — the price
    // is entered by staff at billing time. Mutually exclusive with `variants`.
    open_price: v.optional(v.boolean()),
    is_veg: v.boolean(),
    is_active: v.boolean(),
    has_inventory: v.boolean(),
    image_url: v.optional(v.string()),
    image_storage_id: v.optional(v.id("_storage")),
  })
    .index("by_category", ["category_id"])
    .index("by_active", ["is_active"])
    .index("by_outlet", ["outlet_id"])
    .index("by_outlet_active", ["outlet_id", "is_active"]),

  inventory_stock: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    menu_item_id: v.id("menu_items"),
    quantity: v.number(),
    unit: v.string(),
    low_stock_threshold: v.number(),
    last_restocked_at: v.optional(v.number()),
  })
    .index("by_menu_item", ["menu_item_id"])
    .index("by_outlet", ["outlet_id"]),

  // End-of-day "dump" log — when unsold inventory is thrown out / wasted.
  // Each row records a single discard event so wastage can be reported.
  inventory_dumps: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    menu_item_id: v.id("menu_items"),
    quantity: v.number(),
    reason: v.optional(v.string()),
    dumped_at: v.number(),
    staff_id: v.optional(v.id("restaurant_staff")),
  })
    .index("by_menu_item", ["menu_item_id"])
    .index("by_dumped_at", ["dumped_at"])
    .index("by_outlet", ["outlet_id"]),

  restaurant_staff: defineTable({
    outlet_id: v.optional(v.id("outlets")),
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
    .index("by_username", ["username"])
    .index("by_outlet", ["outlet_id"]),

  restaurant_customers: defineTable({
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    default_address: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_phone", ["phone"]),

  restaurant_orders: defineTable({
    outlet_id: v.optional(v.id("outlets")),
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
    // Where the order originated. Missing == "waiter" (legacy rows).
    source: v.optional(v.union(v.literal("waiter"), v.literal("self_order"))),
  })
    .index("by_status", ["status"])
    .index("by_order_number", ["order_number"])
    .index("by_paid_at", ["paid_at"])
    // Customer module joins from this side; without this index every customer
    // lookup full-scans restaurant_orders.
    .index("by_customer", ["customer_id"])
    .index("by_outlet", ["outlet_id"])
    .index("by_outlet_status", ["outlet_id", "status"])
    .index("by_outlet_paid_at", ["outlet_id", "paid_at"])
    .index("by_outlet_customer", ["outlet_id", "customer_id"]),

  order_items: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    order_id: v.id("restaurant_orders"),
    menu_item_id: v.id("menu_items"),
    name: v.string(),
    // Portion/size chosen for this line, when the menu item is sold in
    // portions (e.g. "Half"). Missing for single-price items.
    variant_label: v.optional(v.string()),
    price: v.number(),
    quantity: v.number(),
    notes: v.optional(v.string()),
    kot_batch: v.optional(v.number()), // null until printed; 1, 2, … when sent to kitchen
    // Who added this line. Missing == "waiter" (legacy / waiter-added).
    source: v.optional(v.union(v.literal("waiter"), v.literal("self_order"))),
  })
    .index("by_order", ["order_id"])
    // Needed when deleting / archiving a menu_item — checks for outstanding
    // references without scanning the entire order_items table.
    .index("by_menu_item", ["menu_item_id"])
    .index("by_outlet", ["outlet_id"]),

  restaurant_reservations: defineTable({
    outlet_id: v.optional(v.id("outlets")),
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
    .index("by_status", ["status"])
    .index("by_outlet", ["outlet_id"]),

  order_payments: defineTable({
    outlet_id: v.optional(v.id("outlets")),
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
    .index("by_paid_at", ["paid_at"])
    .index("by_outlet", ["outlet_id"])
    .index("by_outlet_paid_at", ["outlet_id", "paid_at"]),

  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),

  // Calls from the customer QR portal to the front-of-house. Open rows
  // (acknowledged_at == null) drive the badges in the admin Tables view.
  waiter_calls: defineTable({
    outlet_id: v.optional(v.id("outlets")),
    table_id: v.id("restaurant_tables"),
    reason: v.union(
      v.literal("service"),
      v.literal("bill"),
      v.literal("water"),
      v.literal("other")
    ),
    created_at: v.number(),
    acknowledged_at: v.optional(v.number()),
    acknowledged_by: v.optional(v.id("restaurant_staff")),
  })
    .index("by_table", ["table_id"])
    .index("by_acknowledged_at", ["acknowledged_at"])
    .index("by_created_at", ["created_at"])
    .index("by_outlet", ["outlet_id"]),

  // Token-bucket state for customer self-order endpoints. One row per
  // qr_token, refilled lazily on each consume.
  self_order_rate_limits: defineTable({
    qr_token: v.string(),
    tokens: v.number(),
    last_refill_at: v.number(),
  }).index("by_qr_token", ["qr_token"]),

  // Bearer-token sessions for the Flutter mobile app AND the Next.js web SPA.
  // We store only the SHA-256 hash of the issued token — the raw value is
  // given to the client once at login and never re-derivable from the DB.
  // staff_id == null + is_admin == true marks the hardcoded admin login.
  mobile_sessions: defineTable({
    staff_id: v.union(v.id("restaurant_staff"), v.null()),
    username: v.string(),
    is_admin: v.boolean(),
    // Multi-tenancy: the outlet this session is bound to (null for HQ/super
    // admin, who can see all outlets). Missing on legacy rows.
    outlet_id: v.optional(v.id("outlets")),
    is_hq: v.optional(v.boolean()),
    token_hash: v.string(),
    created_at: v.number(),
    last_used_at: v.number(),
    revoked_at: v.optional(v.number()),
  })
    .index("by_token_hash", ["token_hash"])
    .index("by_staff", ["staff_id"])
    .index("by_outlet", ["outlet_id"]),

  // Token-bucket throttle for the mobile login endpoint. One row per
  // normalized username; refilled lazily on each consume so admins/staff
  // can't be brute-forced through the 10k-PIN keyspace.
  login_attempts: defineTable({
    username: v.string(),
    tokens: v.number(),
    last_refill_at: v.number(),
  }).index("by_username", ["username"]),
});
