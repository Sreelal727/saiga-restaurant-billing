import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { findOrCreateByPhone } from "./customers";

const STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("seated"),
  v.literal("cancelled"),
  v.literal("no_show")
);

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "seated"]);
const DEFAULT_DURATION_MIN = 90;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the first active reservation that overlaps the given window on
 * the same table, ignoring `ignoreId` (the row being edited). Two windows
 * overlap when `a.start < b.end && b.start < a.end`.
 */
async function findConflict(
  ctx: QueryCtx | MutationCtx,
  args: {
    table_id: Id<"restaurant_tables">;
    start: number;
    end: number;
    ignoreId?: Id<"restaurant_reservations">;
  }
): Promise<Doc<"restaurant_reservations"> | null> {
  const onTable = await ctx.db
    .query("restaurant_reservations")
    .withIndex("by_table", (q) => q.eq("table_id", args.table_id))
    .collect();
  for (const r of onTable) {
    if (args.ignoreId && r._id === args.ignoreId) continue;
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    const rEnd = r.scheduled_at + r.duration_minutes * 60_000;
    if (r.scheduled_at < args.end && args.start < rEnd) return r;
  }
  return null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List reservations within an optional time window, optionally filtered
 * by status and a name/phone substring. Sorted by scheduled_at ascending.
 */
export const list = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    status: v.optional(STATUS_VALIDATOR),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { from, to, status, search }) => {
    const term = search?.trim().toLowerCase() ?? "";

    const base = await (async () => {
      if (from !== undefined && to !== undefined) {
        return ctx.db
          .query("restaurant_reservations")
          .withIndex("by_scheduled_at", (q) =>
            q.gte("scheduled_at", from).lt("scheduled_at", to)
          )
          .collect();
      }
      if (from !== undefined) {
        return ctx.db
          .query("restaurant_reservations")
          .withIndex("by_scheduled_at", (q) => q.gte("scheduled_at", from))
          .collect();
      }
      if (to !== undefined) {
        return ctx.db
          .query("restaurant_reservations")
          .withIndex("by_scheduled_at", (q) => q.lt("scheduled_at", to))
          .collect();
      }
      return ctx.db.query("restaurant_reservations").collect();
    })();

    const filtered = base.filter((r) => {
      if (status && r.status !== status) return false;
      if (term) {
        const hit =
          r.customer_name.toLowerCase().includes(term) ||
          r.customer_phone.toLowerCase().includes(term);
        if (!hit) return false;
      }
      return true;
    });

    const sorted = filtered.sort((a, b) => a.scheduled_at - b.scheduled_at);

    return Promise.all(
      sorted.map(async (r) => {
        const table = await ctx.db.get(r.table_id);
        return { ...r, table };
      })
    );
  },
});

export const get = query({
  args: { id: v.id("restaurant_reservations") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) return null;
    const table = await ctx.db.get(r.table_id);
    return { ...r, table };
  },
});

/**
 * Next upcoming reservation per table within `withinMs` of now. Used by
 * the /tables page to surface "Reserved at 19:30 · Anu" badges. Excludes
 * cancelled/no_show and seated (already accounted for in current_order).
 */
export const listNextPerTable = query({
  args: { withinMs: v.optional(v.number()) },
  handler: async (ctx, { withinMs }) => {
    const horizon = withinMs ?? 6 * 60 * 60_000; // default 6 hours
    const now = Date.now();
    const upcoming = await ctx.db
      .query("restaurant_reservations")
      .withIndex("by_scheduled_at", (q) =>
        q.gte("scheduled_at", now).lt("scheduled_at", now + horizon)
      )
      .collect();

    const active = upcoming.filter(
      (r) => r.status === "pending" || r.status === "confirmed"
    );

    const byTable = new Map<Id<"restaurant_tables">, typeof active[number]>();
    for (const r of active) {
      const existing = byTable.get(r.table_id);
      if (!existing || r.scheduled_at < existing.scheduled_at) {
        byTable.set(r.table_id, r);
      }
    }
    return Array.from(byTable.values());
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

function assertValid(args: {
  customer_name: string;
  customer_phone: string;
  party_size: number;
  scheduled_at: number;
  duration_minutes: number;
}): void {
  if (args.customer_name.trim().length === 0) {
    throw new Error("Customer name is required");
  }
  if (args.customer_phone.trim().length === 0) {
    throw new Error("Customer phone is required");
  }
  if (!Number.isFinite(args.party_size) || args.party_size <= 0) {
    throw new Error("Party size must be at least 1");
  }
  if (args.duration_minutes <= 0) {
    throw new Error("Duration must be positive");
  }
}

export const create = mutation({
  args: {
    table_id: v.id("restaurant_tables"),
    customer_name: v.string(),
    customer_phone: v.string(),
    party_size: v.number(),
    scheduled_at: v.number(),
    duration_minutes: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const duration = args.duration_minutes ?? DEFAULT_DURATION_MIN;
    assertValid({ ...args, duration_minutes: duration });

    const start = args.scheduled_at;
    const end = start + duration * 60_000;

    const conflict = await findConflict(ctx, {
      table_id: args.table_id,
      start,
      end,
    });
    if (conflict) {
      throw new Error(
        `Table already booked from ${new Date(conflict.scheduled_at).toLocaleString()} ` +
          `for ${conflict.customer_name}`
      );
    }

    const customer_id =
      (await findOrCreateByPhone(ctx, {
        phone: args.customer_phone,
        name: args.customer_name,
      })) ?? undefined;

    return await ctx.db.insert("restaurant_reservations", {
      table_id: args.table_id,
      customer_id,
      customer_name: args.customer_name.trim(),
      customer_phone: args.customer_phone.trim(),
      party_size: args.party_size,
      scheduled_at: start,
      duration_minutes: duration,
      status: "confirmed",
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("restaurant_reservations"),
    table_id: v.optional(v.id("restaurant_tables")),
    customer_name: v.optional(v.string()),
    customer_phone: v.optional(v.string()),
    party_size: v.optional(v.number()),
    scheduled_at: v.optional(v.number()),
    duration_minutes: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Reservation not found");
    if (existing.status === "seated") {
      throw new Error("Cannot edit a reservation after the party is seated");
    }

    const next = { ...existing, ...fields };

    // Re-validate when time/duration/table change
    const timeChanged =
      fields.scheduled_at !== undefined ||
      fields.duration_minutes !== undefined ||
      fields.table_id !== undefined;
    if (timeChanged) {
      const start = next.scheduled_at;
      const end = start + next.duration_minutes * 60_000;
      const conflict = await findConflict(ctx, {
        table_id: next.table_id,
        start,
        end,
        ignoreId: id,
      });
      if (conflict) {
        throw new Error(
          `Table already booked at that time by ${conflict.customer_name}`
        );
      }
    }

    const patch: Partial<Doc<"restaurant_reservations">> = {};
    if (fields.table_id !== undefined) patch.table_id = fields.table_id;
    if (fields.customer_name !== undefined) {
      if (fields.customer_name.trim().length === 0)
        throw new Error("Customer name cannot be empty");
      patch.customer_name = fields.customer_name.trim();
    }
    if (fields.customer_phone !== undefined) {
      if (fields.customer_phone.trim().length === 0)
        throw new Error("Customer phone cannot be empty");
      patch.customer_phone = fields.customer_phone.trim();
    }
    if (fields.party_size !== undefined) {
      if (fields.party_size <= 0) throw new Error("Party size must be at least 1");
      patch.party_size = fields.party_size;
    }
    if (fields.scheduled_at !== undefined)
      patch.scheduled_at = fields.scheduled_at;
    if (fields.duration_minutes !== undefined) {
      if (fields.duration_minutes <= 0)
        throw new Error("Duration must be positive");
      patch.duration_minutes = fields.duration_minutes;
    }
    if (fields.notes !== undefined)
      patch.notes = fields.notes.trim() || undefined;
    await ctx.db.patch(id, patch);
  },
});

export const cancel = mutation({
  args: { id: v.id("restaurant_reservations") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Reservation not found");
    if (r.status === "seated") {
      throw new Error(
        "Cannot cancel a seated reservation — cancel or settle the order instead"
      );
    }
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

export const markNoShow = mutation({
  args: { id: v.id("restaurant_reservations") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Reservation not found");
    if (r.status === "seated") {
      throw new Error("Cannot mark a seated reservation as no-show");
    }
    await ctx.db.patch(id, { status: "no_show" });
  },
});

/**
 * Mark the party as seated. Marks the table as occupied. The caller is
 * expected to immediately create a new order pointing at the same table —
 * once the order is placed, call `linkOrder` to wire it back to the
 * reservation row for history.
 */
export const markSeated = mutation({
  args: { id: v.id("restaurant_reservations") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Reservation not found");
    if (r.status === "cancelled" || r.status === "no_show") {
      throw new Error("Cannot seat a cancelled or no-show reservation");
    }

    const table = await ctx.db.get(r.table_id);
    if (!table) throw new Error("Table not found");
    if (table.status === "occupied") {
      throw new Error(
        `${table.table_number} is currently occupied — settle the existing order first`
      );
    }

    await ctx.db.patch(id, { status: "seated" });
    await ctx.db.patch(r.table_id, { status: "occupied" });
  },
});

export const linkOrder = mutation({
  args: {
    id: v.id("restaurant_reservations"),
    order_id: v.id("restaurant_orders"),
  },
  handler: async (ctx, { id, order_id }) => {
    await ctx.db.patch(id, { seated_order_id: order_id });
  },
});

export const remove = mutation({
  args: { id: v.id("restaurant_reservations") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Reservation not found");
    if (r.status !== "cancelled" && r.status !== "no_show") {
      throw new Error(
        "Only cancelled or no-show reservations can be deleted. " +
          "Cancel it first if you want to remove it."
      );
    }
    await ctx.db.delete(id);
  },
});
