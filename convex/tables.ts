import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

export const list = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    return await ctx.db
      .query("restaurant_tables")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
  },
});

export const listWithCurrentOrder = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const tables = await ctx.db
      .query("restaurant_tables")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    return Promise.all(
      tables.map(async (table) => {
        if (!table.current_order_id) return { ...table, currentOrder: null };
        const order = await ctx.db.get(table.current_order_id);
        if (!order) return { ...table, currentOrder: null };
        const items = await ctx.db
          .query("order_items")
          .withIndex("by_order", (q) => q.eq("order_id", order._id))
          .collect();
        return {
          ...table,
          currentOrder: {
            _id: order._id,
            order_number: order.order_number,
            status: order.status,
            total: order.total,
            customer_name: order.customer_name ?? null,
            item_count: items.reduce((s, i) => s + i.quantity, 0),
          },
        };
      })
    );
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    table_number: v.string(),
    capacity: v.number(),
  },
  handler: async (ctx, { token, outletId, table_number, capacity }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const trimmed = table_number.trim();
    // Prevent duplicate table numbers (case-insensitive) within this outlet.
    const others = await ctx.db
      .query("restaurant_tables")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    const clash = others.some(
      (t) => t.table_number.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) throw new Error(`A table named "${trimmed}" already exists`);

    return await ctx.db.insert("restaurant_tables", {
      outlet_id: oid,
      table_number,
      capacity,
      status: "available",
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_tables"),
    table_number: v.string(),
    capacity: v.number(),
  },
  handler: async (ctx, { token, outletId, id, table_number, capacity }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const table = await ctx.db.get(id);
    assertSameOutlet(table, oid);
    if (!table) throw new Error("Table not found");

    const trimmed = table_number.trim();
    if (!trimmed) throw new Error("Table number / name is required");
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Capacity must be a whole number of at least 1");
    }

    // Prevent duplicate table numbers (case-insensitive) within this outlet,
    // ignoring this table.
    const others = await ctx.db
      .query("restaurant_tables")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    const clash = others.some(
      (t) => t._id !== id && t.table_number.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) throw new Error(`A table named "${trimmed}" already exists`);

    await ctx.db.patch(id, { table_number: trimmed, capacity });
  },
});

export const updateStatus = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_tables"),
    status: v.union(
      v.literal("available"),
      v.literal("occupied"),
      v.literal("reserved")
    ),
    current_order_id: v.optional(v.id("restaurant_orders")),
  },
  handler: async (ctx, { token, outletId, id, status, current_order_id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    await ctx.db.patch(id, { status, current_order_id });
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_tables"),
  },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    // FIX [HIGH-6 Security]: Block deletion of tables with active orders
    const table = await ctx.db.get(id);
    assertSameOutlet(table, oid);
    if (!table) throw new Error("Table not found");
    if (table.current_order_id) {
      throw new Error("Cannot delete a table with an active order in progress");
    }
    await ctx.db.delete(id);
  },
});

/**
 * Generate (or rotate) the opaque QR token used in customer self-order URLs.
 * Idempotent: if a token already exists and `rotate` isn't set, returns it.
 * The token is unguessable — 24 chars from a URL-safe alphabet (~143 bits).
 *
 * The token is GLOBALLY unique (it resolves an outlet in the public portal),
 * so generation is not scoped by outlet beyond the table's own stamp.
 */
export const issueQrToken = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("restaurant_tables"),
    rotate: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, id, rotate }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const table = await ctx.db.get(id);
    assertSameOutlet(table, oid);
    if (!table) throw new Error("Table not found");
    if (table.qr_token && !rotate) return table.qr_token;

    const qrToken = generateToken(24);
    await ctx.db.patch(id, { qr_token: qrToken });
    return qrToken;
  },
});

const TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generateToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}
