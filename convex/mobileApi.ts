/**
 * Internal endpoints called by convex/http.ts to back the Flutter waiter app.
 *
 * Trust model: HTTP requests authenticate via Bearer token. The token's
 * SHA-256 hash lives in `mobile_sessions`; the raw value is given to the
 * client once at login and never reissued. Most endpoints follow the same
 * pattern — `requireSession` returns `{ session, staff }` from the hash, then
 * the handler does its work.
 */

import { internalMutation, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

// ─── Session resolution ───────────────────────────────────────────────────────

/**
 * Returns the session row + staff doc for a token hash. Mobile endpoints call
 * this first; if it returns null the HTTP layer responds 401.
 */
export const sessionByHash = internalQuery({
  args: { token_hash: v.string() },
  handler: async (ctx, { token_hash }) => {
    const session = await ctx.db
      .query("mobile_sessions")
      .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
      .first();
    if (!session || session.revoked_at !== undefined) return null;

    if (session.is_admin) {
      return {
        session,
        staff: null,
        identity: {
          staff_id: null as Id<"restaurant_staff"> | null,
          name: "Administrator",
          username: session.username,
          role: "manager" as const,
          is_admin: true,
        },
      };
    }
    if (!session.staff_id) return null;
    const staff = await ctx.db.get(session.staff_id);
    if (!staff || !staff.is_active) return null;
    return {
      session,
      staff,
      identity: {
        staff_id: staff._id,
        name: staff.name,
        username: staff.username ?? session.username,
        role: staff.role,
        is_admin: false,
      },
    };
  },
});

/**
 * Verify username/PIN, mint a new session row, return the inserted id. The
 * raw token + its hash are computed in the httpAction (which has crypto
 * primitives); we only persist the hash here so the token can't be replayed
 * from the DB.
 */
export const issueSession = internalMutation({
  args: {
    username: v.string(),
    secret: v.string(),
    token_hash: v.string(),
  },
  handler: async (ctx, { username, secret, token_hash }) => {
    const normalized = username.trim().toLowerCase();
    if (normalized.length === 0 || secret.length === 0) return null;

    const adminUser = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;

    if (normalized === adminUser) {
      // No fallback default — the deployment must have ADMIN_PASSWORD set.
      if (!adminPass) return null;
      if (secret !== adminPass) return null;
      const now = Date.now();
      const id = await ctx.db.insert("mobile_sessions", {
        staff_id: null,
        username: adminUser,
        is_admin: true,
        token_hash,
        created_at: now,
        last_used_at: now,
      });
      return {
        session_id: id,
        identity: {
          staff_id: null as Id<"restaurant_staff"> | null,
          name: "Administrator",
          username: adminUser,
          role: "manager" as const,
          is_admin: true,
        },
      };
    }

    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!staff || !staff.is_active) return null;
    if (!staff.pin || staff.pin !== secret) return null;

    const now = Date.now();
    const id = await ctx.db.insert("mobile_sessions", {
      staff_id: staff._id,
      username: staff.username ?? normalized,
      is_admin: false,
      token_hash,
      created_at: now,
      last_used_at: now,
    });
    return {
      session_id: id,
      identity: {
        staff_id: staff._id,
        name: staff.name,
        username: staff.username ?? normalized,
        role: staff.role,
        is_admin: false,
      },
    };
  },
});

export const revokeSession = internalMutation({
  args: { token_hash: v.string() },
  handler: async (ctx, { token_hash }) => {
    const session = await ctx.db
      .query("mobile_sessions")
      .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
      .first();
    if (!session) return;
    await ctx.db.patch(session._id, { revoked_at: Date.now() });
  },
});

export const touchSession = internalMutation({
  args: { session_id: v.id("mobile_sessions") },
  handler: async (ctx, { session_id }) => {
    const s = await ctx.db.get(session_id);
    if (!s || s.revoked_at !== undefined) return;
    await ctx.db.patch(session_id, { last_used_at: Date.now() });
  },
});

// ─── Login brute-force protection ─────────────────────────────────────────────

// Capacity = 5 attempts before throttling kicks in. Refill = 1 token/30s, so a
// throttled user gets back to a fresh bucket in ~2.5 minutes. Honest users
// rarely need more than 1–2 tries; attackers see a fast brake.
const LOGIN_BUCKET_CAPACITY = 5;
const LOGIN_REFILL_PER_SECOND = 1 / 30;

export const consumeLoginAttempt = internalMutation({
  args: { username: v.string() },
  handler: async (
    ctx,
    { username }
  ): Promise<{ allowed: boolean; retry_after_seconds: number }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("login_attempts")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();

    if (!existing) {
      await ctx.db.insert("login_attempts", {
        username,
        tokens: LOGIN_BUCKET_CAPACITY - 1,
        last_refill_at: now,
      });
      return { allowed: true, retry_after_seconds: 0 };
    }

    const elapsedSec = Math.max(0, (now - existing.last_refill_at) / 1000);
    const refilled = Math.min(
      LOGIN_BUCKET_CAPACITY,
      existing.tokens + elapsedSec * LOGIN_REFILL_PER_SECOND
    );

    if (refilled < 1) {
      const retry = Math.ceil((1 - refilled) / LOGIN_REFILL_PER_SECOND);
      // Keep the bucket pinned at zero — don't let a flood reset last_refill_at.
      await ctx.db.patch(existing._id, {
        tokens: refilled,
        last_refill_at: now,
      });
      return { allowed: false, retry_after_seconds: retry };
    }

    await ctx.db.patch(existing._id, {
      tokens: refilled - 1,
      last_refill_at: now,
    });
    return { allowed: true, retry_after_seconds: 0 };
  },
});

export const clearLoginAttempts = internalMutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const existing = await ctx.db
      .query("login_attempts")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ─── Bootstrap query: tables + menu in one round-trip ─────────────────────────

/**
 * Used by the app's main "home" pull-to-refresh / poll loop. Bundles enough
 * to render the tables grid (with per-table self-order arrival counts) so we
 * don't pay 3 round-trips on every tick.
 */
export const home = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tables = await ctx.db.query("restaurant_tables").collect();
    const settings = (await ctx.db.query("restaurant_settings").collect())[0] ?? null;

    const enriched = await Promise.all(
      tables.map(async (table) => {
        const summary = await tableSummary(ctx, table);
        return summary;
      })
    );

    enriched.sort((a, b) =>
      a.table_number.localeCompare(b.table_number, undefined, { numeric: true })
    );

    return {
      tables: enriched,
      settings: {
        restaurant_name: settings?.restaurant_name ?? "Restaurant",
        currency: settings?.currency ?? "₹",
        cgst_rate: settings?.cgst_rate ?? 0,
        sgst_rate: settings?.sgst_rate ?? 0,
      },
    };
  },
});

type TableSummary = {
  _id: Id<"restaurant_tables">;
  table_number: string;
  capacity: number;
  status: Doc<"restaurant_tables">["status"];
  current_order_id: Id<"restaurant_orders"> | null;
  order: {
    _id: Id<"restaurant_orders">;
    order_number: string;
    status: Doc<"restaurant_orders">["status"];
    total: number;
    item_count: number;
    pending_kot_count: number; // un-printed line items
    self_order_count: number;  // line items from QR portal (any state)
  } | null;
  open_call_count: number;     // un-acknowledged waiter calls
};

async function tableSummary(
  ctx: QueryCtx,
  table: Doc<"restaurant_tables">
): Promise<TableSummary> {
  let order: TableSummary["order"] = null;
  if (table.current_order_id) {
    const o = await ctx.db.get(table.current_order_id);
    if (o && o.status !== "paid" && o.status !== "cancelled") {
      const items = await ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", o._id))
        .collect();
      order = {
        _id: o._id,
        order_number: o.order_number,
        status: o.status,
        total: o.total,
        item_count: items.reduce((s, i) => s + i.quantity, 0),
        pending_kot_count: items.filter((i) => i.kot_batch === undefined).length,
        self_order_count: items.filter((i) => i.source === "self_order").length,
      };
    }
  }

  const openCalls = await ctx.db
    .query("waiter_calls")
    .withIndex("by_table", (q) => q.eq("table_id", table._id))
    .filter((q) => q.eq(q.field("acknowledged_at"), undefined))
    .collect();

  return {
    _id: table._id,
    table_number: table.table_number,
    capacity: table.capacity,
    status: table.status,
    current_order_id: table.current_order_id ?? null,
    order,
    open_call_count: openCalls.length,
  };
}

// ─── Menu bundle for the picker sheet ────────────────────────────────────────

export const menu = internalQuery({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .filter((q) => q.eq(q.field("is_active"), true))
      .collect();

    const items = await ctx.db
      .query("menu_items")
      .withIndex("by_active", (q) => q.eq("is_active", true))
      .collect();

    const stocks = await ctx.db.query("inventory_stock").collect();
    const stockByItem = new Map(stocks.map((s) => [s.menu_item_id as string, s.quantity]));

    const enriched = await Promise.all(
      items.map(async (item) => {
        let url: string | null = item.image_url ?? null;
        if (item.image_storage_id) {
          url = await ctx.storage.getUrl(item.image_storage_id);
        }
        return {
          _id: item._id,
          category_id: item.category_id,
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          is_veg: item.is_veg,
          has_inventory: item.has_inventory,
          stock: stockByItem.get(item._id as unknown as string) ?? null,
          image_url: url,
        };
      })
    );

    return categories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      display_order: cat.display_order,
      items: enriched.filter((i) => i.category_id === cat._id),
    }));
  },
});

// ─── Order detail for the order screen ────────────────────────────────────────

export const orderDetail = internalQuery({
  args: { order_id: v.id("restaurant_orders") },
  handler: async (ctx, { order_id }) => {
    const order = await ctx.db.get(order_id);
    if (!order) return null;
    const [table, items] = await Promise.all([
      order.table_id ? ctx.db.get(order.table_id) : null,
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", order_id))
        .collect(),
    ]);
    return {
      _id: order._id,
      order_number: order.order_number,
      status: order.status,
      source: order.source ?? "waiter",
      table: table
        ? { _id: table._id, table_number: table.table_number, capacity: table.capacity }
        : null,
      subtotal: order.subtotal,
      discount_amount: order.discount_amount,
      cgst_amount: order.cgst_amount,
      sgst_amount: order.sgst_amount,
      total: order.total,
      notes: order.notes ?? null,
      kot_count: order.kot_count ?? 0,
      items: items
        .map((i) => ({
          _id: i._id,
          menu_item_id: i.menu_item_id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          notes: i.notes ?? null,
          kot_batch: i.kot_batch ?? null,
          source: i.source ?? "waiter",
        }))
        .sort((a, b) => {
          // unprinted first, then by KOT batch
          const ak = a.kot_batch ?? Infinity;
          const bk = b.kot_batch ?? Infinity;
          return ak - bk;
        }),
    };
  },
});

// ─── Mutations the HTTP layer dispatches to ───────────────────────────────────

/**
 * Create or append. If the table is already occupied with a usable order,
 * just append items (and stamp them with source="waiter"); otherwise create
 * a fresh dine_in order with the given waiter as owner.
 */
export const createOrAppend = internalMutation({
  args: {
    table_id: v.id("restaurant_tables"),
    waiter_id: v.union(v.id("restaurant_staff"), v.null()),
    items: v.array(
      v.object({
        menu_item_id: v.id("menu_items"),
        quantity: v.number(),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { table_id, waiter_id, items }) => {
    const table = await ctx.db.get(table_id);
    if (!table) throw new Error("Table not found");
    if (items.length === 0) throw new Error("No items provided");

    const priced = await priceAndCheck(ctx, items);

    const existing = table.current_order_id
      ? await ctx.db.get(table.current_order_id)
      : null;
    const usable =
      existing && existing.status !== "paid" && existing.status !== "cancelled"
        ? existing
        : null;

    const orderId = usable
      ? await appendItems(ctx, usable, priced)
      : await createOrder(ctx, table, waiter_id, priced);

    await deductStock(ctx, priced);
    return { order_id: orderId };
  },
});

/**
 * Remove a line that hasn't been sent to the kitchen yet. Once a line is
 * stamped with a kot_batch the waiter has to do a manual cancel — this
 * keeps the printed paper trail consistent.
 */
export const removeUnsentItem = internalMutation({
  args: { item_id: v.id("order_items") },
  handler: async (ctx, { item_id }) => {
    const item = await ctx.db.get(item_id);
    if (!item) throw new Error("Item not found");
    if (item.kot_batch !== undefined) {
      throw new Error("Item already sent to kitchen — cannot remove");
    }
    const order = await ctx.db.get(item.order_id);
    if (!order) throw new Error("Order not found");
    if (order.status === "paid" || order.status === "cancelled") {
      throw new Error("Cannot modify a paid or cancelled order");
    }

    // Restock if tracked
    const stock = await ctx.db
      .query("inventory_stock")
      .withIndex("by_menu_item", (q) => q.eq("menu_item_id", item.menu_item_id))
      .first();
    if (stock) {
      await ctx.db.patch(stock._id, { quantity: stock.quantity + item.quantity });
    }

    await ctx.db.delete(item._id);
    await recomputeTotals(ctx, item.order_id);
  },
});

/**
 * Stamp every un-printed line on the order with the next KOT batch number.
 * Mirrors orders.markKotPrinted.
 */
export const sendKot = internalMutation({
  args: { order_id: v.id("restaurant_orders") },
  handler: async (ctx, { order_id }) => {
    const order = await ctx.db.get(order_id);
    if (!order) throw new Error("Order not found");
    if (order.status === "cancelled") {
      throw new Error("Cannot send KOT for a cancelled order");
    }
    const allItems = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("order_id", order_id))
      .collect();
    const pending = allItems.filter((i) => i.kot_batch === undefined);
    if (pending.length === 0) {
      return { batch_number: null, item_count: 0 };
    }
    const batch_number = (order.kot_count ?? 0) + 1;
    await ctx.db.patch(order_id, { kot_count: batch_number });
    await Promise.all(
      pending.map((item) => ctx.db.patch(item._id, { kot_batch: batch_number }))
    );
    // When the first KOT fires, nudge the order out of "pending" into "preparing"
    // so the rest of the workflow can see it.
    if (order.status === "pending") {
      await ctx.db.patch(order_id, { status: "preparing" });
    }
    return { batch_number, item_count: pending.length };
  },
});

export const updateOrderStatus = internalMutation({
  args: {
    order_id: v.id("restaurant_orders"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("served"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, { order_id, status }) => {
    const order = await ctx.db.get(order_id);
    if (!order) throw new Error("Order not found");
    await ctx.db.patch(order_id, { status });
    // Free table if cancelled. (Payment flips paid+frees via reconcile path.)
    if (status === "cancelled" && order.table_id) {
      await ctx.db.patch(order.table_id, {
        status: "available",
        current_order_id: undefined,
      });
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PricedLine = {
  menu_item_id: Id<"menu_items">;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

async function priceAndCheck(
  ctx: MutationCtx,
  raw: Array<{
    menu_item_id: Id<"menu_items">;
    quantity: number;
    notes?: string;
  }>
): Promise<PricedLine[]> {
  return Promise.all(
    raw.map(async (line) => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new Error("Invalid quantity");
      }
      const menuItem = await ctx.db.get(line.menu_item_id);
      if (!menuItem) throw new Error("Menu item not found");
      if (!menuItem.is_active) throw new Error(`Not available: ${menuItem.name}`);
      const stock = await ctx.db
        .query("inventory_stock")
        .withIndex("by_menu_item", (q) => q.eq("menu_item_id", line.menu_item_id))
        .first();
      if (stock && stock.quantity < line.quantity) {
        throw new Error(
          `Out of stock: ${menuItem.name} (only ${stock.quantity} left)`
        );
      }
      const note = line.notes?.trim().slice(0, 200);
      return {
        menu_item_id: line.menu_item_id,
        name: menuItem.name,
        price: menuItem.price,
        quantity: line.quantity,
        notes: note && note.length > 0 ? note : undefined,
      };
    })
  );
}

async function deductStock(ctx: MutationCtx, priced: PricedLine[]): Promise<void> {
  await Promise.all(
    priced.map(async (item) => {
      const stock = await ctx.db
        .query("inventory_stock")
        .withIndex("by_menu_item", (q) => q.eq("menu_item_id", item.menu_item_id))
        .first();
      if (!stock) return;
      await ctx.db.patch(stock._id, {
        quantity: stock.quantity - item.quantity,
      });
    })
  );
}

async function appendItems(
  ctx: MutationCtx,
  order: Doc<"restaurant_orders">,
  lines: PricedLine[]
): Promise<Id<"restaurant_orders">> {
  if (order.status === "paid" || order.status === "cancelled") {
    throw new Error("Cannot modify a paid or cancelled order");
  }
  await Promise.all(
    lines.map((item) =>
      ctx.db.insert("order_items", { ...item, order_id: order._id, source: "waiter" })
    )
  );
  await recomputeTotals(ctx, order._id);
  return order._id;
}

async function createOrder(
  ctx: MutationCtx,
  table: Doc<"restaurant_tables">,
  waiter_id: Id<"restaurant_staff"> | null,
  lines: PricedLine[]
): Promise<Id<"restaurant_orders">> {
  const settings = (await ctx.db.query("restaurant_settings").collect())[0];
  const cgst_rate = settings?.cgst_rate ?? 0;
  const sgst_rate = settings?.sgst_rate ?? 0;

  const subtotal = lines.reduce((s, i) => s + i.price * i.quantity, 0);
  const cgst_amount = (subtotal * cgst_rate) / 100;
  const sgst_amount = (subtotal * sgst_rate) / 100;
  const total = subtotal + cgst_amount + sgst_amount;

  const order_number = await nextOrderNumber(ctx);
  const orderId = await ctx.db.insert("restaurant_orders", {
    order_number,
    order_type: "dine_in",
    status: "pending",
    table_id: table._id,
    waiter_id: waiter_id ?? undefined,
    subtotal: round2(subtotal),
    discount_percent: 0,
    discount_amount: 0,
    cgst_rate,
    sgst_rate,
    cgst_amount: round2(cgst_amount),
    sgst_amount: round2(sgst_amount),
    tips: 0,
    packing_charge: 0,
    delivery_charge: 0,
    total: round2(total),
    source: "waiter",
  });

  await Promise.all(
    lines.map((item) =>
      ctx.db.insert("order_items", { ...item, order_id: orderId, source: "waiter" })
    )
  );

  await ctx.db.patch(table._id, {
    status: "occupied",
    current_order_id: orderId,
  });

  return orderId;
}

async function recomputeTotals(
  ctx: MutationCtx,
  orderId: Id<"restaurant_orders">
): Promise<void> {
  const order = await ctx.db.get(orderId);
  if (!order) return;
  const allItems = await ctx.db
    .query("order_items")
    .withIndex("by_order", (q) => q.eq("order_id", orderId))
    .collect();
  const subtotal = allItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount_amount = (subtotal * order.discount_percent) / 100;
  const taxable = subtotal - discount_amount;
  const cgst_amount = (taxable * order.cgst_rate) / 100;
  const sgst_amount = (taxable * order.sgst_rate) / 100;
  const total =
    taxable + cgst_amount + sgst_amount + order.tips + order.packing_charge + order.delivery_charge;
  await ctx.db.patch(orderId, {
    subtotal: round2(subtotal),
    discount_amount: round2(discount_amount),
    cgst_amount: round2(cgst_amount),
    sgst_amount: round2(sgst_amount),
    total: round2(total),
  });
}

async function nextOrderNumber(ctx: MutationCtx): Promise<string> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", "order_number"))
    .first();
  const next = (counter?.value ?? 0) + 1;
  if (counter) await ctx.db.patch(counter._id, { value: next });
  else await ctx.db.insert("counters", { key: "order_number", value: next });
  return `ORD-${String(next).padStart(5, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
