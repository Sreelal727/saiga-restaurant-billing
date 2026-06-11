/**
 * Public APIs for the customer-facing QR self-order portal.
 *
 * Trust model: the route is unauthenticated; the qr_token printed on the
 * physical table tent is the only gate. Every function here resolves the
 * table from the token and refuses to expose anything tied to a different
 * table. Prices, taxes, and stock are always re-derived from the DB —
 * client values are never trusted.
 */

import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

// ─── Limits (keep modest to deter casual abuse) ───────────────────────────────

const MAX_ITEMS_PER_SUBMIT = 30;
const MAX_QTY_PER_ITEM = 20;
const MAX_NOTE_LENGTH = 100;

// Token-bucket per qr_token. Capacity covers normal "cart, then call waiter,
// then add a few more items" behaviour; refill is slow enough that a script
// hammering submit gets stopped fast.
const BUCKET_CAPACITY = 8;
const REFILL_PER_SECOND = 1 / 6; // 1 token every 6s, i.e. ~10/min steady-state

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tableByToken(
  ctx: QueryCtx,
  token: string
): Promise<Doc<"restaurant_tables"> | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return await ctx.db
    .query("restaurant_tables")
    .withIndex("by_qr_token", (q) => q.eq("qr_token", trimmed))
    .first();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Refill the table's bucket lazily, then try to consume one token. Throws
 * a user-friendly message when empty. Safe under Convex's transactional
 * mutations — one row per qr_token, atomic read-modify-write.
 */
async function consumeRateToken(ctx: MutationCtx, qr_token: string): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("self_order_rate_limits")
    .withIndex("by_qr_token", (q) => q.eq("qr_token", qr_token))
    .first();

  if (!existing) {
    // First request from this table — capacity minus the token we're about to consume.
    await ctx.db.insert("self_order_rate_limits", {
      qr_token,
      tokens: BUCKET_CAPACITY - 1,
      last_refill_at: now,
    });
    return;
  }

  const elapsedSec = Math.max(0, (now - existing.last_refill_at) / 1000);
  const refilled = Math.min(
    BUCKET_CAPACITY,
    existing.tokens + elapsedSec * REFILL_PER_SECOND
  );

  if (refilled < 1) {
    const secsToOne = Math.ceil((1 - refilled) / REFILL_PER_SECOND);
    throw new Error(
      `You're going a little fast — please wait ${secsToOne}s and try again.`
    );
  }

  await ctx.db.patch(existing._id, {
    tokens: refilled - 1,
    last_refill_at: now,
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

// ─── Public query: bootstrap the portal ───────────────────────────────────────

/**
 * Returns everything the customer page needs in one round-trip:
 *   - the table (number + capacity only)
 *   - active order summary (no PII)
 *   - active menu grouped by category
 *   - currency + tax rates so we can render a live total preview
 *
 * Reactive: appended items show up immediately while the customer is on the page.
 */
export const getContext = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const table = await tableByToken(ctx, token);
    if (!table) return null;
    // A reserved table without an open order belongs to whoever booked it —
    // walking up and scanning the tent QR shouldn't bypass the host. We only
    // reject when there's no active order (status === "reserved"); if there's
    // already an open order on the table the customer is the right occupant.
    if (table.status === "reserved" && !table.current_order_id) {
      return { table_reserved: true as const };
    }

    const settings = (await ctx.db.query("restaurant_settings").collect())[0] ?? null;

    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .filter((q) => q.eq(q.field("is_active"), true))
      .collect();

    const activeItems = await ctx.db
      .query("menu_items")
      .withIndex("by_active", (q) => q.eq("is_active", true))
      .collect();

    const itemsWithImage = await Promise.all(
      activeItems.map(async (item) => {
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
          image_url: url,
        };
      })
    );

    const menu = categories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      display_order: cat.display_order,
      items: itemsWithImage.filter((i) => i.category_id === cat._id),
    }));

    // Active order summary for the cart screen — minimal fields, no PII.
    let activeOrder: {
      _id: Id<"restaurant_orders">;
      order_number: string;
      status: string;
      total: number;
      items: Array<{
        _id: Id<"order_items">;
        menu_item_id: Id<"menu_items">;
        name: string;
        price: number;
        quantity: number;
        notes: string | null;
        sent_to_kitchen: boolean;
      }>;
    } | null = null;

    if (table.current_order_id) {
      const order = await ctx.db.get(table.current_order_id);
      if (order && order.status !== "paid" && order.status !== "cancelled") {
        const items = await ctx.db
          .query("order_items")
          .withIndex("by_order", (q) => q.eq("order_id", order._id))
          .collect();
        activeOrder = {
          _id: order._id,
          order_number: order.order_number,
          status: order.status,
          total: order.total,
          items: items.map((i) => ({
            _id: i._id,
            menu_item_id: i.menu_item_id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            notes: i.notes ?? null,
            sent_to_kitchen: i.kot_batch !== undefined,
          })),
        };
      }
    }

    return {
      table: {
        _id: table._id,
        table_number: table.table_number,
        capacity: table.capacity,
      },
      settings: {
        restaurant_name: settings?.restaurant_name ?? "Restaurant",
        currency: settings?.currency ?? "₹",
        cgst_rate: settings?.cgst_rate ?? 0,
        sgst_rate: settings?.sgst_rate ?? 0,
      },
      menu,
      activeOrder,
    };
  },
});

// ─── Public mutation: submit cart ─────────────────────────────────────────────

/**
 * Customer-side order submission:
 *   - If the table already has an open order, append items (waiter still
 *     controls when KOT fires).
 *   - Otherwise create a new dine_in order with source="self_order" and
 *     mark the table occupied.
 *
 * Authoritative price, name, and stock are looked up server-side. Submitted
 * items wait for the waiter to print the KOT, matching the existing flow.
 */
export const submit = mutation({
  args: {
    token: v.string(),
    items: v.array(
      v.object({
        menu_item_id: v.id("menu_items"),
        quantity: v.number(),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { token, items }) => {
    const table = await tableByToken(ctx, token);
    if (!table) throw new Error("Invalid table link");
    if (table.status === "reserved" && !table.current_order_id) {
      throw new Error("This table is reserved — please ask staff to seat you.");
    }

    // Rate-limit before any other work so attackers can't probe the menu
    // through repeated submits.
    await consumeRateToken(ctx, token.trim());

    if (items.length === 0) throw new Error("Cart is empty");
    if (items.length > MAX_ITEMS_PER_SUBMIT) {
      throw new Error(`Too many line items (max ${MAX_ITEMS_PER_SUBMIT})`);
    }

    // Validate + resolve each line against the DB
    const priced = await Promise.all(
      items.map(async (line) => {
        if (!Number.isInteger(line.quantity) || line.quantity < 1) {
          throw new Error("Invalid quantity");
        }
        if (line.quantity > MAX_QTY_PER_ITEM) {
          throw new Error(`Max ${MAX_QTY_PER_ITEM} per item`);
        }
        const menuItem = await ctx.db.get(line.menu_item_id);
        if (!menuItem) throw new Error("Item not found");
        if (!menuItem.is_active) {
          throw new Error(`Not available: ${menuItem.name}`);
        }
        const note = line.notes?.trim().slice(0, MAX_NOTE_LENGTH);
        return {
          menu_item_id: line.menu_item_id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: line.quantity,
          notes: note && note.length > 0 ? note : undefined,
        };
      })
    );

    // Check stock and deduct in a single pass per item — eliminates the
    // TOCTOU window between a separate "check all" and "deduct all" loop where
    // two concurrent submits for the last unit could both pass the check.
    // We don't leak exact remaining quantities back to the public portal —
    // an attacker probing the menu shouldn't get an inventory readout.
    await Promise.all(
      priced.map(async (item) => {
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_menu_item", (q) =>
            q.eq("menu_item_id", item.menu_item_id)
          )
          .first();
        if (!stock) return;
        if (stock.quantity < item.quantity) {
          throw new Error(`${item.name} is currently unavailable.`);
        }
        await ctx.db.patch(stock._id, {
          quantity: stock.quantity - item.quantity,
        });
      })
    );

    const existing = table.current_order_id
      ? await ctx.db.get(table.current_order_id)
      : null;
    const usable =
      existing && existing.status !== "paid" && existing.status !== "cancelled"
        ? existing
        : null;

    const orderId = usable
      ? await appendToOrder(ctx, usable, priced)
      : await createNewOrder(ctx, table, priced);

    return { order_id: orderId };
  },
});

// ─── Public mutation: call waiter ─────────────────────────────────────────────

const CALL_REASON_VALIDATOR = v.union(
  v.literal("service"),
  v.literal("bill"),
  v.literal("water"),
  v.literal("other")
);

/**
 * Customer raises a request from their table. If a recent open call already
 * exists for this table (within 60s), we leave it alone instead of stacking
 * duplicates — the front-of-house only needs one signal per intent.
 */
export const callWaiter = mutation({
  args: {
    token: v.string(),
    reason: CALL_REASON_VALIDATOR,
  },
  handler: async (ctx, { token, reason }) => {
    const table = await tableByToken(ctx, token);
    if (!table) throw new Error("Invalid table link");

    await consumeRateToken(ctx, token.trim());

    const recentOpen = await ctx.db
      .query("waiter_calls")
      .withIndex("by_table", (q) => q.eq("table_id", table._id))
      .filter((q) => q.eq(q.field("acknowledged_at"), undefined))
      .order("desc")
      .first();

    const now = Date.now();
    // De-duplicate: same reason within 60s reuses the open row.
    if (
      recentOpen &&
      recentOpen.reason === reason &&
      now - recentOpen.created_at < 60_000
    ) {
      return { call_id: recentOpen._id, deduplicated: true };
    }

    const id = await ctx.db.insert("waiter_calls", {
      table_id: table._id,
      reason,
      created_at: now,
    });
    return { call_id: id, deduplicated: false };
  },
});

// ─── Internals ────────────────────────────────────────────────────────────────

type PricedLine = {
  menu_item_id: Id<"menu_items">;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

async function appendToOrder(
  ctx: MutationCtx,
  order: Doc<"restaurant_orders">,
  lines: PricedLine[]
): Promise<Id<"restaurant_orders">> {
  await Promise.all(
    lines.map((item) =>
      ctx.db.insert("order_items", { ...item, order_id: order._id, source: "self_order" })
    )
  );

  const allItems = await ctx.db
    .query("order_items")
    .withIndex("by_order", (q) => q.eq("order_id", order._id))
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

  await ctx.db.patch(order._id, {
    subtotal: round2(subtotal),
    discount_amount: round2(discount_amount),
    cgst_amount: round2(cgst_amount),
    sgst_amount: round2(sgst_amount),
    total: round2(total),
  });

  return order._id;
}

async function createNewOrder(
  ctx: MutationCtx,
  table: Doc<"restaurant_tables">,
  lines: PricedLine[]
): Promise<Id<"restaurant_orders">> {
  const settings = (await ctx.db.query("restaurant_settings").collect())[0];
  const cgst_rate = settings?.cgst_rate ?? 0;
  const sgst_rate = settings?.sgst_rate ?? 0;

  const subtotal = lines.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxable = subtotal;
  const cgst_amount = (taxable * cgst_rate) / 100;
  const sgst_amount = (taxable * sgst_rate) / 100;
  const total = taxable + cgst_amount + sgst_amount;

  const order_number = await nextOrderNumber(ctx);

  const orderId = await ctx.db.insert("restaurant_orders", {
    order_number,
    order_type: "dine_in",
    status: "pending",
    table_id: table._id,
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
    source: "self_order",
  });

  await Promise.all(
    lines.map((item) =>
      ctx.db.insert("order_items", { ...item, order_id: orderId, source: "self_order" })
    )
  );

  await ctx.db.patch(table._id, {
    status: "occupied",
    current_order_id: orderId,
  });

  return orderId;
}
