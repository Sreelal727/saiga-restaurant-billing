import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { findOrCreateByPhone } from "./customers";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

// A single order line as submitted by a client. Name + price are resolved
// server-side, EXCEPT for "as per size" (open_price) items where the staff-
// entered `price` is honoured (validated against the item's open_price flag).
const ORDER_LINE_VALIDATOR = v.object({
  menu_item_id: v.id("menu_items"),
  quantity: v.number(),
  variant_label: v.optional(v.string()),
  price: v.optional(v.number()),
  notes: v.optional(v.string()),
});

type OrderLineInput = {
  menu_item_id: Id<"menu_items">;
  quantity: number;
  variant_label?: string;
  price?: number;
  notes?: string;
};

type ResolvedLine = {
  menu_item_id: Id<"menu_items">;
  name: string;
  variant_label?: string;
  price: number;
  quantity: number;
  notes?: string;
  unit_factor: number; // stock consumed per unit (1 for single-price items)
};

/**
 * Resolve a client line against the DB: authoritative name + price, and — for
 * items sold in portions — the chosen variant's price and stock factor. Throws
 * if the item is missing/inactive, the quantity is invalid, or a portioned item
 * was added without a valid portion selection.
 */
async function resolveOrderLine(
  ctx: MutationCtx,
  line: OrderLineInput,
  outletId: Id<"outlets">
): Promise<ResolvedLine> {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new Error(`Invalid quantity for item ${line.menu_item_id}`);
  }
  const menuItem = await ctx.db.get(line.menu_item_id);
  if (!menuItem) throw new Error(`Menu item not found: ${line.menu_item_id}`);
  // Can't add another outlet's item to this outlet's order.
  assertSameOutlet(menuItem, outletId);
  if (!menuItem.is_active) throw new Error(`Item is not available: ${menuItem.name}`);

  let price = menuItem.price;
  let unit_factor = 1;
  let variant_label: string | undefined;

  if (menuItem.open_price) {
    // "As per size" — trust the staff-entered price (this item has no fixed one).
    const entered = line.price;
    if (entered === undefined || !Number.isFinite(entered) || entered < 0) {
      throw new Error(`Enter a price for "${menuItem.name}"`);
    }
    price = entered;
    unit_factor = 1;
    variant_label = undefined;
  } else if (menuItem.variants && menuItem.variants.length > 0) {
    const wanted = line.variant_label?.trim();
    const variant = wanted
      ? menuItem.variants.find((vr) => vr.label === wanted)
      : undefined;
    if (!variant) {
      throw new Error(`Select a portion size for "${menuItem.name}"`);
    }
    price = variant.price;
    unit_factor = variant.unit_factor ?? 1;
    variant_label = variant.label;
  }

  return {
    menu_item_id: line.menu_item_id,
    name: menuItem.name,
    variant_label,
    price,
    quantity: line.quantity,
    notes: line.notes,
    unit_factor,
  };
}

/**
 * Persist a resolved line as an order_item row (drops the transient
 * unit_factor, which is only used for stock deduction).
 */
async function insertOrderLine(
  ctx: MutationCtx,
  orderId: Id<"restaurant_orders">,
  outletId: Id<"outlets">,
  line: ResolvedLine,
  source: "waiter" | "self_order"
): Promise<void> {
  await ctx.db.insert("order_items", {
    outlet_id: outletId,
    order_id: orderId,
    menu_item_id: line.menu_item_id,
    name: line.name,
    variant_label: line.variant_label,
    price: line.price,
    quantity: line.quantity,
    notes: line.notes,
    source,
  });
}

/**
 * Deduct stock for a resolved line (unit_factor × quantity). No-op for items
 * without a stock record. A sale is never blocked on a stock-out — the stock
 * is deducted regardless (it may go negative) so usage reporting stays
 * accurate while the counter keeps selling. (Product decision.)
 */
async function deductStockForLine(ctx: MutationCtx, line: ResolvedLine): Promise<void> {
  const stock = await ctx.db
    .query("inventory_stock")
    .withIndex("by_menu_item", (q) => q.eq("menu_item_id", line.menu_item_id))
    .first();
  if (!stock) return; // not a tracked item
  const needed = line.unit_factor * line.quantity;
  await ctx.db.patch(stock._id, { quantity: round2(stock.quantity - needed) });
}

const ORDER_STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("served"),
  v.literal("paid"),
  v.literal("cancelled")
);

async function nextOrderNumber(
  ctx: MutationCtx,
  outletId: Id<"outlets">
): Promise<string> {
  // Per-outlet order-number series.
  const key = `order_number:${outletId}`;
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  const next = (counter?.value ?? 0) + 1;

  if (counter) {
    await ctx.db.patch(counter._id, { value: next });
  } else {
    await ctx.db.insert("counters", { key, value: next });
  }

  return `ORD-${String(next).padStart(5, "0")}`;
}

/**
 * List orders with optional status filter + text search.
 * When search is provided, performs an in-memory contains match against
 * order_number and customer_name within the last `limit` (default 200) orders.
 */
export const list = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    status: v.optional(ORDER_STATUS_VALIDATOR),
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { token, outletId, status, limit, search }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    // Cap the page size — callers must not be able to dump the whole table
    // by passing a huge limit.
    const MAX_LIMIT = 500;
    const resolvedLimit = Math.max(1, Math.min(MAX_LIMIT, limit ?? 200));
    const term = search?.trim().toLowerCase() ?? "";

    const raw = status
      ? await ctx.db
          .query("restaurant_orders")
          .withIndex("by_outlet_status", (q) =>
            q.eq("outlet_id", oid).eq("status", status)
          )
          .order("desc")
          .take(resolvedLimit)
      : await ctx.db
          .query("restaurant_orders")
          .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
          .order("desc")
          .take(resolvedLimit);

    const filtered =
      term.length > 0
        ? raw.filter(
            (o) =>
              o.order_number.toLowerCase().includes(term) ||
              (o.customer_name?.toLowerCase().includes(term) ?? false)
          )
        : raw;

    return Promise.all(
      filtered.map(async (o) => {
        const [table, waiter, items] = await Promise.all([
          o.table_id ? ctx.db.get(o.table_id) : null,
          o.waiter_id ? ctx.db.get(o.waiter_id) : null,
          ctx.db
            .query("order_items")
            .withIndex("by_order", (q) => q.eq("order_id", o._id))
            .collect(),
        ]);
        return { ...o, table, waiter, items };
      })
    );
  },
});

/**
 * Cursor-based paginated order list. Use with `usePaginatedQuery` on the frontend.
 */
export const listPaginated = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    status: v.optional(ORDER_STATUS_VALIDATOR),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { token, outletId, status, paginationOpts }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const result = status
      ? await ctx.db
          .query("restaurant_orders")
          .withIndex("by_outlet_status", (q) =>
            q.eq("outlet_id", oid).eq("status", status)
          )
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("restaurant_orders")
          .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
          .order("desc")
          .paginate(paginationOpts);

    const enriched = await Promise.all(
      result.page.map(async (o) => {
        const [table, waiter, items] = await Promise.all([
          o.table_id ? ctx.db.get(o.table_id) : null,
          o.waiter_id ? ctx.db.get(o.waiter_id) : null,
          ctx.db
            .query("order_items")
            .withIndex("by_order", (q) => q.eq("order_id", o._id))
            .collect(),
        ]);
        return { ...o, table, waiter, items };
      })
    );

    return { ...result, page: enriched };
  },
});

export const get = query({
  args: { token: v.string(), outletId: v.id("outlets"), id: v.id("restaurant_orders") },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) return null;
    assertSameOutlet(order, oid);
    const [table, waiter, items, payments] = await Promise.all([
      order.table_id ? ctx.db.get(order.table_id) : null,
      order.waiter_id ? ctx.db.get(order.waiter_id) : null,
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", id))
        .collect(),
      ctx.db
        .query("order_payments")
        .withIndex("by_order", (q) => q.eq("order_id", id))
        .collect(),
    ]);
    const total_paid = payments.reduce((s, p) => s + p.amount, 0);
    const balance_due = Math.max(0, round2(order.total - total_paid));
    return {
      ...order,
      table,
      waiter,
      items,
      payments,
      total_paid: round2(total_paid),
      balance_due,
    };
  },
});

/**
 * Today's orders for one table (most recent first) — for the table-view history.
 * Scoped to the caller's outlet.
 */
export const tableHistoryToday = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    tableId: v.id("restaurant_tables"),
  },
  handler: async (ctx, { token, outletId, tableId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    const recent = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .order("desc")
      .take(500);

    const forTable = recent.filter(
      (o) => o.table_id === tableId && o._creationTime >= todayTs
    );

    return Promise.all(
      forTable.map(async (o) => {
        const items = await ctx.db
          .query("order_items")
          .withIndex("by_order", (q) => q.eq("order_id", o._id))
          .collect();
        return {
          _id: o._id,
          order_number: o.order_number,
          status: o.status,
          total: o.total,
          created: o._creationTime,
          item_count: items.reduce((s, i) => s + i.quantity, 0),
        };
      })
    );
  },
});

/**
 * Today's order total + count per table for the whole outlet, in one pass —
 * powers the "today" badge on the table cards. Excludes cancelled orders.
 * Returns a map keyed by table_id.
 */
export const tableTotalsToday = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    const recent = await ctx.db
      .query("restaurant_orders")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .order("desc")
      .take(1000);

    const totals: Record<string, { total: number; count: number }> = {};
    for (const o of recent) {
      if (o._creationTime < todayTs) continue;
      if (!o.table_id || o.status === "cancelled") continue;
      const key = o.table_id as string;
      const cur = totals[key] ?? { total: 0, count: 0 };
      cur.total += o.total;
      cur.count += 1;
      totals[key] = cur;
    }
    return totals;
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * After a payment is added or removed, recompute the order's payment state.
 * If the order is now fully paid, flip status + free table + snapshot the
 * "last" payment_method onto the order. If it falls back below paid (e.g.
 * a payment was removed), revert status to "served".
 */
async function reconcileOrderPaidState(
  ctx: MutationCtx,
  orderId: import("./_generated/dataModel").Id<"restaurant_orders">
): Promise<void> {
  const order = await ctx.db.get(orderId);
  if (!order) return;
  const payments = await ctx.db
    .query("order_payments")
    .withIndex("by_order", (q) => q.eq("order_id", orderId))
    .collect();

  const total_paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  const fully_paid = total_paid + 0.005 >= order.total;

  if (fully_paid) {
    // Newest payment supplies the snapshot fields
    const last = payments.reduce(
      (acc, p) => (p.paid_at > (acc?.paid_at ?? 0) ? p : acc),
      payments[0]
    );
    const snapshot_method =
      last.method === "online" ? "upi" : (last.method as "cash" | "card" | "upi");
    await ctx.db.patch(orderId, {
      status: "paid",
      payment_method: snapshot_method,
      paid_at: last.paid_at,
    });
    if (order.table_id) {
      await ctx.db.patch(order.table_id, {
        status: "available",
        current_order_id: undefined,
      });
    }
  } else if (order.status === "paid") {
    // A payment was removed and the order is no longer fully covered —
    // revert to "served" so the cashier can record more payments.
    await ctx.db.patch(orderId, {
      status: "served",
      payment_method: undefined,
      paid_at: undefined,
    });
    if (order.table_id) {
      // Re-occupy the table since the order is back in service
      await ctx.db.patch(order.table_id, {
        status: "occupied",
        current_order_id: orderId,
      });
    }
  }
}

export const create = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    order_type: v.union(
      v.literal("dine_in"),
      v.literal("takeaway"),
      v.literal("delivery")
    ),
    table_id: v.optional(v.id("restaurant_tables")),
    waiter_id: v.optional(v.id("restaurant_staff")),
    customer_id: v.optional(v.id("restaurant_customers")),
    customer_name: v.optional(v.string()),
    customer_phone: v.optional(v.string()),
    delivery_address: v.optional(v.string()),
    // FIX [CRITICAL-2]: Remove client-supplied price/name — looked up from DB below
    items: v.array(ORDER_LINE_VALIDATOR),
    discount_amount: v.number(),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    tips: v.number(),
    packing_charge: v.number(),
    delivery_charge: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { outletId: oid } = await requireOutlet(ctx, args.token, args.outletId);
    // FIX [MEDIUM-8]: Validate items array is non-empty at mutation layer
    if (args.items.length === 0) {
      throw new Error("Order must contain at least one item");
    }

    // FIX [HIGH-4]: Validate discount and charge bounds
    if (args.discount_amount < 0) {
      throw new Error("Discount cannot be negative");
    }
    if (args.tips < 0 || args.packing_charge < 0 || args.delivery_charge < 0) {
      throw new Error("Charges cannot be negative");
    }

    // FIX [CRITICAL-2]: Look up authoritative price and name from DB; discard client values
    const itemsWithPrices = await Promise.all(
      args.items.map((item) => resolveOrderLine(ctx, item, oid))
    );

    // Resolve / link the customer record (auto-create if a phone is supplied
    // but the caller didn't pass an explicit customer_id). Order keeps the
    // denormalized name/phone/address as a historical snapshot regardless.
    let customer_id = args.customer_id;
    if (!customer_id && args.customer_phone) {
      customer_id =
        (await findOrCreateByPhone(ctx, {
          phone: args.customer_phone,
          name: args.customer_name,
          default_address: args.delivery_address,
        })) ?? undefined;
    }

    const order_number = await nextOrderNumber(ctx, oid);

    const subtotal = itemsWithPrices.reduce((s, i) => s + i.price * i.quantity, 0);
    // Discount is a flat rupee amount, clamped so it never exceeds the subtotal.
    // discount_percent is kept as a derived snapshot for legacy readers.
    const discount_amount = round2(Math.min(args.discount_amount, subtotal));
    const discount_percent =
      subtotal > 0 ? round2((discount_amount / subtotal) * 100) : 0;
    const taxable = subtotal - discount_amount;
    const cgst_amount = (taxable * args.cgst_rate) / 100;
    const sgst_amount = (taxable * args.sgst_rate) / 100;
    const total =
      taxable +
      cgst_amount +
      sgst_amount +
      args.tips +
      args.packing_charge +
      args.delivery_charge;

    const orderId = await ctx.db.insert("restaurant_orders", {
      outlet_id: oid,
      order_number,
      order_type: args.order_type,
      status: "pending",
      table_id: args.table_id,
      waiter_id: args.waiter_id,
      customer_id,
      customer_name: args.customer_name,
      customer_phone: args.customer_phone,
      delivery_address: args.delivery_address,
      subtotal,
      discount_percent,
      discount_amount,
      cgst_rate: args.cgst_rate,
      sgst_rate: args.sgst_rate,
      cgst_amount,
      sgst_amount,
      tips: args.tips,
      packing_charge: args.packing_charge,
      delivery_charge: args.delivery_charge,
      total,
      notes: args.notes,
    });

    await Promise.all(
      itemsWithPrices.map((item) => insertOrderLine(ctx, orderId, oid, item, "waiter"))
    );

    // Mark table as occupied (must belong to this outlet)
    if (args.table_id) {
      assertSameOutlet(await ctx.db.get(args.table_id), oid);
      await ctx.db.patch(args.table_id, {
        status: "occupied",
        current_order_id: orderId,
      });
    }

    // Deduct inventory — stock records exist only for has_inventory=true items.
    // Portions consume a fraction per unit (Quarter 0.25, Half 0.5, Full 1).
    // Stock-outs never block a sale; stock may go negative for reporting.
    await Promise.all(itemsWithPrices.map((item) => deductStockForLine(ctx, item)));

    return orderId;
  },
});

// Allowed forward (or terminal) transitions for the order lifecycle. The KDS
// can advance an order through preparing → ready → served; `cancelled` is
// reachable from any non-terminal state; everything else is blocked so a
// fat-fingered click can't move a served order back to "confirmed".
const ALLOWED_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
  served: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export const updateStatus = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
    status: ORDER_STATUS_VALIDATOR,
  },
  handler: async (ctx, { token, outletId, id, status }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);

    if (order.status === status) return; // no-op
    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new Error(
        `Cannot move order from "${order.status}" to "${status}".`
      );
    }

    await ctx.db.patch(id, { status });

    // Free the table when order is paid or cancelled
    if ((status === "paid" || status === "cancelled") && order.table_id) {
      await ctx.db.patch(order.table_id, {
        status: "available",
        current_order_id: undefined,
      });
    }
  },
});

/**
 * Add a single payment toward the order's balance. Multiple payments per
 * order are supported (split bill). When sum(payments) ≥ total the order
 * status flips to "paid" and the table is freed.
 */
export const addPayment = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
    amount: v.number(),
    method: v.union(
      v.literal("cash"),
      v.literal("card"),
      v.literal("upi"),
      v.literal("online")
    ),
    payer_name: v.optional(v.string()),
    customer_id: v.optional(v.id("restaurant_customers")),
  },
  handler: async (ctx, { token, outletId, id, amount, method, payer_name, customer_id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);
    if (order.status === "cancelled") {
      throw new Error("Cannot record payment on a cancelled order");
    }
    if (amount <= 0) throw new Error("Payment amount must be positive");

    const existing = await ctx.db
      .query("order_payments")
      .withIndex("by_order", (q) => q.eq("order_id", id))
      .collect();
    const already_paid = existing.reduce((s, p) => s + p.amount, 0);
    const balance = round2(order.total - already_paid);

    // Allow tiny floating-point slop, otherwise block overpayment
    if (amount - balance > 0.005) {
      throw new Error(
        `Payment of ₹${amount} exceeds balance due of ₹${balance.toFixed(2)}`
      );
    }

    const paymentId = await ctx.db.insert("order_payments", {
      outlet_id: oid,
      order_id: id,
      amount: round2(amount),
      method,
      paid_at: Date.now(),
      payer_name: payer_name?.trim() || undefined,
      customer_id,
    });

    await reconcileOrderPaidState(ctx, id);
    return paymentId;
  },
});

/**
 * Remove a previously recorded payment (e.g. correction). If removal drops
 * the order below fully-paid, status reverts to "served" and the table is
 * re-occupied.
 */
export const removePayment = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("order_payments"),
  },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const payment = await ctx.db.get(id);
    if (!payment) throw new Error("Payment not found");
    assertSameOutlet(payment, oid);
    const orderId = payment.order_id;
    await ctx.db.delete(id);
    await reconcileOrderPaidState(ctx, orderId);
  },
});

/**
 * Legacy single-shot payment — pays the entire remaining balance with one
 * method. Implemented on top of addPayment so behaviour stays consistent.
 */
export const recordPayment = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
    payment_method: v.union(
      v.literal("cash"),
      v.literal("card"),
      v.literal("upi")
    ),
  },
  handler: async (ctx, { token, outletId, id, payment_method }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);
    if (order.status === "cancelled") {
      throw new Error("Cannot record payment on a cancelled order");
    }
    const payments = await ctx.db
      .query("order_payments")
      .withIndex("by_order", (q) => q.eq("order_id", id))
      .collect();
    const already_paid = payments.reduce((s, p) => s + p.amount, 0);
    const balance = round2(order.total - already_paid);
    if (balance <= 0) {
      // Nothing to pay — just make sure the snapshot fields are consistent.
      await reconcileOrderPaidState(ctx, id);
      return;
    }
    await ctx.db.insert("order_payments", {
      outlet_id: oid,
      order_id: id,
      amount: balance,
      method: payment_method,
      paid_at: Date.now(),
    });
    await reconcileOrderPaidState(ctx, id);
  },
});

export const addItems = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
    items: v.array(ORDER_LINE_VALIDATOR),
  },
  handler: async (ctx, { token, outletId, id, items }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);
    if (order.status === "paid" || order.status === "cancelled") {
      throw new Error("Cannot modify a paid or cancelled order");
    }
    if (items.length === 0) throw new Error("No items provided");

    const itemsWithPrices = await Promise.all(
      items.map((item) => resolveOrderLine(ctx, item, oid))
    );

    // Deduct inventory — stock-outs never block; stock may go negative.
    await Promise.all(itemsWithPrices.map((item) => deductStockForLine(ctx, item)));

    await Promise.all(
      itemsWithPrices.map((item) => insertOrderLine(ctx, id, oid, item, "waiter"))
    );

    // Recalculate totals from the full updated item list
    const allItems = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("order_id", id))
      .collect();

    const subtotal = allItems.reduce((s, i) => s + i.price * i.quantity, 0);
    // Preserve the flat rupee discount (clamped to the new subtotal); refresh
    // the derived percent snapshot to match.
    const discount_amount = round2(Math.min(order.discount_amount, subtotal));
    const discount_percent =
      subtotal > 0 ? round2((discount_amount / subtotal) * 100) : 0;
    const taxable = subtotal - discount_amount;
    const cgst_amount = (taxable * order.cgst_rate) / 100;
    const sgst_amount = (taxable * order.sgst_rate) / 100;
    const total =
      taxable +
      cgst_amount +
      sgst_amount +
      order.tips +
      order.packing_charge +
      order.delivery_charge;

    await ctx.db.patch(id, {
      subtotal,
      discount_amount,
      discount_percent,
      cgst_amount,
      sgst_amount,
      total,
    });
  },
});

/**
 * Mark all unprinted order_items as sent to the kitchen as the next KOT batch.
 * Returns the batch number + the items now stamped with it. Idempotent: if
 * there's nothing new to print, returns `{ batch_number: null, items: [] }`.
 */
export const markKotPrinted = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
  },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);
    if (order.status === "cancelled") {
      throw new Error("Cannot print KOT for a cancelled order");
    }

    const allItems = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("order_id", id))
      .collect();
    const pending = allItems.filter((i) => i.kot_batch === undefined);
    if (pending.length === 0) {
      return { batch_number: null, items: [] as typeof pending };
    }

    const batch_number = (order.kot_count ?? 0) + 1;
    // First KOT advances a freshly-created (pending) order to "confirmed" so it
    // surfaces on the Kitchen Display (which ignores "pending"). Mirrors the
    // mobile waiter app's sendKot behaviour.
    const patch: { kot_count: number; status?: "confirmed" } = {
      kot_count: batch_number,
    };
    if (order.status === "pending") patch.status = "confirmed";
    await ctx.db.patch(id, patch);
    await Promise.all(
      pending.map((item) => ctx.db.patch(item._id, { kot_batch: batch_number }))
    );

    return { batch_number, items: pending };
  },
});

export const updateCharges = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_orders"),
    discount_percent: v.number(),
    tips: v.number(),
    packing_charge: v.number(),
    delivery_charge: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { token, outletId, id, discount_percent, tips, packing_charge, delivery_charge, notes }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    // FIX [HIGH-4]: Validate bounds on charges
    if (discount_percent < 0 || discount_percent > 100) {
      throw new Error("discount_percent must be between 0 and 100");
    }
    if (tips < 0 || packing_charge < 0 || delivery_charge < 0) {
      throw new Error("Charges cannot be negative");
    }

    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    assertSameOutlet(order, oid);

    const discount_amount = (order.subtotal * discount_percent) / 100;
    const taxable = order.subtotal - discount_amount;
    const cgst_amount = (taxable * order.cgst_rate) / 100;
    const sgst_amount = (taxable * order.sgst_rate) / 100;
    const total =
      taxable + cgst_amount + sgst_amount + tips + packing_charge + delivery_charge;

    await ctx.db.patch(id, {
      discount_percent,
      discount_amount,
      cgst_amount,
      sgst_amount,
      tips,
      packing_charge,
      delivery_charge,
      total,
      notes,
    });
  },
});
