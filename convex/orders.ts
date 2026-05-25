import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";

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

export const list = query({
  args: {
    // FIX [HIGH-3]: Use enum validator instead of v.string() to prevent arbitrary status values
    status: v.optional(ORDER_STATUS_VALIDATOR),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    // FIX [MEDIUM-12]: Use .take() instead of .collect() + slice to avoid full table scan
    const resolvedLimit = limit ?? 200;

    const orders = status
      ? await ctx.db
          .query("restaurant_orders")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .take(resolvedLimit)
      : await ctx.db
          .query("restaurant_orders")
          .order("desc")
          .take(resolvedLimit);

    return Promise.all(
      orders.map(async (o) => {
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

export const get = query({
  args: { id: v.id("restaurant_orders") },
  handler: async (ctx, { id }) => {
    const order = await ctx.db.get(id);
    if (!order) return null;
    const [table, waiter, items] = await Promise.all([
      order.table_id ? ctx.db.get(order.table_id) : null,
      order.waiter_id ? ctx.db.get(order.waiter_id) : null,
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", id))
        .collect(),
    ]);
    return { ...order, table, waiter, items };
  },
});

export const create = mutation({
  args: {
    order_type: v.union(
      v.literal("dine_in"),
      v.literal("takeaway"),
      v.literal("delivery")
    ),
    table_id: v.optional(v.id("restaurant_tables")),
    waiter_id: v.optional(v.id("restaurant_staff")),
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

    await ctx.db.patch(id, {
      status: "paid",
      payment_method,
      paid_at: Date.now(),
    });

    if (order.table_id) {
      await ctx.db.patch(order.table_id, {
        status: "available",
        current_order_id: undefined,
      });
    }
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
