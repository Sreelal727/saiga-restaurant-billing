import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

function normalizePhone(raw: string): string {
  return raw.trim();
}

function assertCustomerInput(name: string, phone: string): void {
  if (name.trim().length === 0) throw new Error("Customer name is required");
  if (phone.trim().length === 0) throw new Error("Customer phone is required");
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List customers, optionally filtered by name/phone substring.
 * Returned in most-recently-created order so new entries surface first.
 */
export const list = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const term = search?.trim().toLowerCase() ?? "";
    const all = await ctx.db
      .query("restaurant_customers")
      .order("desc")
      .collect();
    if (term.length === 0) return all;
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.phone.toLowerCase().includes(term) ||
        (c.email?.toLowerCase().includes(term) ?? false)
    );
  },
});

/**
 * Like `list` but each row is annotated with order_count and total_spent
 * derived from paid orders. Use this on the Customers admin page.
 */
export const listWithStats = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const term = search?.trim().toLowerCase() ?? "";
    const customers = await ctx.db
      .query("restaurant_customers")
      .order("desc")
      .collect();

    const filtered =
      term.length === 0
        ? customers
        : customers.filter(
            (c) =>
              c.name.toLowerCase().includes(term) ||
              c.phone.toLowerCase().includes(term) ||
              (c.email?.toLowerCase().includes(term) ?? false)
          );

    return Promise.all(
      filtered.map(async (c) => {
        const orders = await ctx.db
          .query("restaurant_orders")
          .filter((q) => q.eq(q.field("customer_id"), c._id))
          .collect();
        const paid = orders.filter((o) => o.status === "paid");
        const total_spent = paid.reduce((s, o) => s + o.total, 0);
        return {
          ...c,
          order_count: orders.length,
          paid_order_count: paid.length,
          total_spent,
        };
      })
    );
  },
});

export const get = query({
  args: { id: v.id("restaurant_customers") },
  handler: async (ctx, { id }) => {
    const customer = await ctx.db.get(id);
    if (!customer) return null;
    const orders = await ctx.db
      .query("restaurant_orders")
      .filter((q) => q.eq(q.field("customer_id"), id))
      .order("desc")
      .collect();
    const paid = orders.filter((o) => o.status === "paid");
    return {
      ...customer,
      orders,
      order_count: orders.length,
      paid_order_count: paid.length,
      total_spent: paid.reduce((s, o) => s + o.total, 0),
    };
  },
});

/**
 * Look up an existing customer by phone — used by /orders/new for autofill
 * and by orders.create for auto-link on order placement.
 */
export const findByPhone = query({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const normalized = normalizePhone(phone);
    if (normalized.length === 0) return null;
    return await ctx.db
      .query("restaurant_customers")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .first();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Internal helper — find a customer by phone or create one. Used by
 * orders.create to auto-link new orders that include a phone but no
 * customer_id.
 */
export async function findOrCreateByPhone(
  ctx: MutationCtx,
  args: { phone: string; name?: string; default_address?: string }
): Promise<Id<"restaurant_customers"> | null> {
  const phone = normalizePhone(args.phone);
  if (phone.length === 0) return null;
  const existing = await ctx.db
    .query("restaurant_customers")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  if (existing) return existing._id;
  if (!args.name || args.name.trim().length === 0) return null;
  return await ctx.db.insert("restaurant_customers", {
    name: args.name.trim(),
    phone,
    default_address: args.default_address?.trim() || undefined,
  });
}

export const create = mutation({
  args: {
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    default_address: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertCustomerInput(args.name, args.phone);
    const phone = normalizePhone(args.phone);
    const existing = await ctx.db
      .query("restaurant_customers")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (existing) {
      throw new Error("A customer with this phone number already exists");
    }
    return await ctx.db.insert("restaurant_customers", {
      name: args.name.trim(),
      phone,
      email: args.email?.trim() || undefined,
      default_address: args.default_address?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("restaurant_customers"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    default_address: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    if (fields.name !== undefined && fields.name.trim().length === 0) {
      throw new Error("Name cannot be empty");
    }
    if (fields.phone !== undefined) {
      const phone = normalizePhone(fields.phone);
      if (phone.length === 0) throw new Error("Phone cannot be empty");
      const dupe = await ctx.db
        .query("restaurant_customers")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .first();
      if (dupe && dupe._id !== id) {
        throw new Error("Another customer already uses this phone number");
      }
      fields.phone = phone;
    }
    const patch: Partial<Doc<"restaurant_customers">> = {};
    if (fields.name !== undefined) patch.name = fields.name.trim();
    if (fields.phone !== undefined) patch.phone = fields.phone;
    if (fields.email !== undefined)
      patch.email = fields.email.trim() || undefined;
    if (fields.default_address !== undefined)
      patch.default_address = fields.default_address.trim() || undefined;
    if (fields.notes !== undefined)
      patch.notes = fields.notes.trim() || undefined;
    await ctx.db.patch(id, patch);
  },
});

/**
 * Delete a customer. If any order still references the customer_id, the
 * customer is hidden by clearing the link rather than orphaning rows —
 * but we block hard-delete to keep order history intact and force the
 * caller to make a deliberate choice.
 */
export const remove = mutation({
  args: { id: v.id("restaurant_customers") },
  handler: async (ctx, { id }) => {
    const order = await ctx.db
      .query("restaurant_orders")
      .filter((q) => q.eq(q.field("customer_id"), id))
      .first();
    if (order) {
      throw new Error(
        "Cannot delete a customer linked to existing orders. " +
          "Their order history would be detached."
      );
    }
    await ctx.db.delete(id);
  },
});
