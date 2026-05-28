import { mutation, query, MutationCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { findOrCreateByPhone } from "./customers";

const ORDER_STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("served"),
  v.literal("paid"),
  v.literal("cancelled")
);

async function nextOrderNumber(ctx: MutationCtx): Promise<string> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", "order_number"))
    .first();

  const next = (counter?.value ?? 0) + 1;

  if (counter) {
    await ctx.db.patch(counter._id, { value: next });
  } else {
    await ctx.db.insert("counters", { key: "order_number", value: next });
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
    status: v.optional(ORDER_STATUS_VALIDATOR),
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { status, limit, search }) => {
    const resolvedLimit = limit ?? 200;
    const term = search?.trim().toLowerCase() ?? "";

    const raw = status
      ? await ctx.db
          .query("restaurant_orders")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .take(resolvedLimit)
      : await ctx.db
          .query("restaurant_orders")
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
    status: v.optional(ORDER_STATUS_VALIDATOR),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { status, paginationOpts }) => {
    const result = status
      ? await ctx.db
          .query("restaurant_orders")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("restaurant_orders")
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
  args: { id: v.id("restaurant_orders") },
  handler: async (ctx, { id }) => {
    const order = await ctx.db.get(id);
    if (!order) return null;
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
    items: v.array(
      v.object({
        menu_item_id: v.id("menu_items"),
        quantity: v.number(),
        notes: v.optional(v.string()),
      })
    ),
    discount_percent: v.number(),
    cgst_rate: v.number(),
    sgst_rate: v.number(),
    tips: v.number(),
    packing_charge: v.number(),
    delivery_charge: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // FIX [MEDIUM-8]: Validate items array is non-empty at mutation layer
    if (args.items.length === 0) {
      throw new Error("Order must contain at least one item");
    }

    // FIX [HIGH-4]: Validate discount and charge bounds
    if (args.discount_percent < 0 || args.discount_percent > 100) {
      throw new Error("discount_percent must be between 0 and 100");
    }
    if (args.tips < 0 || args.packing_charge < 0 || args.delivery_charge < 0) {
      throw new Error("Charges cannot be negative");
    }

    // FIX [CRITICAL-2]: Look up authoritative price and name from DB; discard client values
    const itemsWithPrices = await Promise.all(
      args.items.map(async (item) => {
        // FIX [MEDIUM-9]: Validate quantity is a positive integer
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new Error(`Invalid quantity for item ${item.menu_item_id}`);
        }
        const menuItem = await ctx.db.get(item.menu_item_id);
        if (!menuItem) throw new Error(`Menu item not found: ${item.menu_item_id}`);
        if (!menuItem.is_active) throw new Error(`Item is not available: ${menuItem.name}`);
        return {
          menu_item_id: item.menu_item_id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: item.quantity,
          notes: item.notes,
        };
      })
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

    const order_number = await nextOrderNumber(ctx);

    const subtotal = itemsWithPrices.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount_amount = (subtotal * args.discount_percent) / 100;
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
      discount_percent: args.discount_percent,
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
      itemsWithPrices.map((item) =>
        ctx.db.insert("order_items", { ...item, order_id: orderId })
      )
    );

    // Mark table as occupied
    if (args.table_id) {
      await ctx.db.patch(args.table_id, {
        status: "occupied",
        current_order_id: orderId,
      });
    }

    // Deduct inventory — stock records exist only for has_inventory=true items
    // FIX [Code-Finding-4]: Throw when tracked stock is insufficient instead of silent skip
    await Promise.all(
      itemsWithPrices.map(async (item) => {
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_menu_item", (q) =>
            q.eq("menu_item_id", item.menu_item_id)
          )
          .first();
        if (!stock) return; // not a tracked item — skip
        if (stock.quantity < item.quantity) {
          throw new Error(
            `Insufficient stock for "${item.name}". Available: ${stock.quantity}, requested: ${item.quantity}`
          );
        }
        await ctx.db.patch(stock._id, {
          quantity: stock.quantity - item.quantity,
        });
      })
    );

    return orderId;
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("restaurant_orders"),
    status: ORDER_STATUS_VALIDATOR,
  },
  handler: async (ctx, { id, status }) => {
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");

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
  handler: async (ctx, { id, amount, method, payer_name, customer_id }) => {
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
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
  args: { id: v.id("order_payments") },
  handler: async (ctx, { id }) => {
    const payment = await ctx.db.get(id);
    if (!payment) throw new Error("Payment not found");
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
    id: v.id("restaurant_orders"),
    payment_method: v.union(
      v.literal("cash"),
      v.literal("card"),
      v.literal("upi")
    ),
  },
  handler: async (ctx, { id, payment_method }) => {
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
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
    id: v.id("restaurant_orders"),
    items: v.array(
      v.object({
        menu_item_id: v.id("menu_items"),
        quantity: v.number(),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { id, items }) => {
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
    if (order.status === "paid" || order.status === "cancelled") {
      throw new Error("Cannot modify a paid or cancelled order");
    }
    if (items.length === 0) throw new Error("No items provided");

    const itemsWithPrices = await Promise.all(
      items.map(async (item) => {
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new Error("Invalid quantity");
        }
        const menuItem = await ctx.db.get(item.menu_item_id);
        if (!menuItem) throw new Error(`Menu item not found`);
        if (!menuItem.is_active) throw new Error(`Item not available: ${menuItem.name}`);
        return {
          menu_item_id: item.menu_item_id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: item.quantity,
          notes: item.notes,
        };
      })
    );

    // Deduct inventory first — throw if any item is under-stocked
    await Promise.all(
      itemsWithPrices.map(async (item) => {
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_menu_item", (q) => q.eq("menu_item_id", item.menu_item_id))
          .first();
        if (!stock) return;
        if (stock.quantity < item.quantity) {
          throw new Error(
            `Insufficient stock for "${item.name}". Available: ${stock.quantity}`
          );
        }
        await ctx.db.patch(stock._id, { quantity: stock.quantity - item.quantity });
      })
    );

    await Promise.all(
      itemsWithPrices.map((item) =>
        ctx.db.insert("order_items", { ...item, order_id: id })
      )
    );

    // Recalculate totals from the full updated item list
    const allItems = await ctx.db
      .query("order_items")
      .withIndex("by_order", (q) => q.eq("order_id", id))
      .collect();

    const subtotal = allItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const discount_amount = (subtotal * order.discount_percent) / 100;
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
  args: { id: v.id("restaurant_orders") },
  handler: async (ctx, { id }) => {
    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");
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
    await ctx.db.patch(id, { kot_count: batch_number });
    await Promise.all(
      pending.map((item) => ctx.db.patch(item._id, { kot_batch: batch_number }))
    );

    return { batch_number, items: pending };
  },
});

export const updateCharges = mutation({
  args: {
    id: v.id("restaurant_orders"),
    discount_percent: v.number(),
    tips: v.number(),
    packing_charge: v.number(),
    delivery_charge: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, discount_percent, tips, packing_charge, delivery_charge, notes }) => {
    // FIX [HIGH-4]: Validate bounds on charges
    if (discount_percent < 0 || discount_percent > 100) {
      throw new Error("discount_percent must be between 0 and 100");
    }
    if (tips < 0 || packing_charge < 0 || delivery_charge < 0) {
      throw new Error("Charges cannot be negative");
    }

    const order = await ctx.db.get(id);
    if (!order) throw new Error("Order not found");

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
