import { mutation, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireOutlet } from "./lib/tenant";

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface PaymentBreakdown {
  cash_collected: number;
  card_collected: number;
  upi_collected: number;
  online_collected: number;
  total_collected: number;
  orders_count: number;
}

/**
 * Sum this outlet's payments received since `since` (ms), split by method.
 * `orders_count` is the number of distinct bills that took money in the window.
 * Uses the by_outlet_paid_at index so only this outlet's timestamped payments
 * are scanned (legacy rows without outlet_id are excluded, same as reports).
 */
async function paymentsSince(
  ctx: QueryCtx,
  oid: Id<"outlets">,
  since: number
): Promise<PaymentBreakdown> {
  const payments = await ctx.db
    .query("order_payments")
    .withIndex("by_outlet_paid_at", (q) =>
      q.eq("outlet_id", oid).gte("paid_at", since)
    )
    .collect();

  let cash = 0;
  let card = 0;
  let upi = 0;
  let online = 0;
  const orderIds = new Set<string>();
  for (const p of payments) {
    if (p.method === "cash") cash += p.amount;
    else if (p.method === "card") card += p.amount;
    else if (p.method === "upi") upi += p.amount;
    else if (p.method === "online") online += p.amount;
    orderIds.add(p.order_id);
  }
  return {
    cash_collected: round2(cash),
    card_collected: round2(card),
    upi_collected: round2(upi),
    online_collected: round2(online),
    total_collected: round2(cash + card + upi + online),
    orders_count: orderIds.size,
  };
}

interface OpenBillLite {
  _id: Id<"restaurant_orders">;
  order_number: string;
  order_type: string;
  status: string;
  table_number: string | null;
  total: number;
  balance_due: number;
  _creationTime: number;
}

/** All still-open (unsettled, non-cancelled) bills for the outlet, lightest form. */
async function openBillsFor(
  ctx: QueryCtx,
  oid: Id<"outlets">
): Promise<OpenBillLite[]> {
  const recent = await ctx.db
    .query("restaurant_orders")
    .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
    .order("desc")
    .take(500);
  const open = recent.filter(
    (o) => o.status !== "paid" && o.status !== "cancelled"
  );
  return Promise.all(
    open.map(async (o) => {
      const [payments, table] = await Promise.all([
        ctx.db
          .query("order_payments")
          .withIndex("by_order", (q) => q.eq("order_id", o._id))
          .collect(),
        o.table_id ? ctx.db.get(o.table_id) : null,
      ]);
      const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
      return {
        _id: o._id,
        order_number: o.order_number,
        order_type: o.order_type,
        status: o.status,
        table_number: table?.table_number ?? null,
        total: o.total,
        balance_due: Math.max(0, round2(o.total - paid)),
        _creationTime: o._creationTime,
      };
    })
  );
}

async function openSessionFor(ctx: QueryCtx, oid: Id<"outlets">) {
  return ctx.db
    .query("day_sessions")
    .withIndex("by_outlet_status", (q) =>
      q.eq("outlet_id", oid).eq("status", "open")
    )
    .first();
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Pre-open info for the "Open Day" panel: whether a day is already open and the
 * cash carried in from the previous close (the suggested opening balance).
 */
export const openInfo = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const [open, prev] = await Promise.all([
      openSessionFor(ctx, oid),
      ctx.db
        .query("day_sessions")
        .withIndex("by_outlet_status", (q) =>
          q.eq("outlet_id", oid).eq("status", "closed")
        )
        .order("desc")
        .first(),
    ]);
    return {
      has_open: !!open,
      suggested_opening: round2(prev?.counted_cash ?? 0),
      last_closed_at: prev?.closed_at ?? null,
    };
  },
});

/**
 * Live summary of the currently open day for the outlet. Returns null when no
 * day is open. Drives the day-controls bar and every panel (opening balance,
 * handover, close).
 */
export const summary = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const session = await openSessionFor(ctx, oid);
    if (!session) return null;

    const lastHandover = await ctx.db
      .query("shift_handovers")
      .withIndex("by_day_session", (q) => q.eq("day_session_id", session._id))
      .order("desc")
      .first();
    const shiftSince = lastHandover?.at ?? session.opened_at;

    const [day, shift, bills, handovers] = await Promise.all([
      paymentsSince(ctx, oid, session.opened_at),
      paymentsSince(ctx, oid, shiftSince),
      openBillsFor(ctx, oid),
      ctx.db
        .query("shift_handovers")
        .withIndex("by_day_session", (q) => q.eq("day_session_id", session._id))
        .order("desc")
        .collect(),
    ]);

    const open_bills_total = round2(
      bills.reduce((s, b) => s + b.balance_due, 0)
    );

    return {
      session: {
        _id: session._id,
        opened_at: session.opened_at,
        opened_by_name: session.opened_by_name,
        current_handler_name: session.current_handler_name,
        opening_balance: session.opening_balance,
        suggested_opening: session.suggested_opening ?? 0,
        opening_corrections: session.opening_corrections,
      },
      day,
      shift: { ...shift, since: shiftSince },
      open_bills: bills,
      open_bills_total,
      // Only cash changes the physical drawer.
      expected_cash: round2(session.opening_balance + day.cash_collected),
      handovers: handovers.map((h) => ({
        _id: h._id,
        at: h.at,
        from_name: h.from_name,
        to_name: h.to_name,
        notes: h.notes,
        snapshot: h.snapshot,
      })),
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const openDay = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    opened_by_name: v.string(),
    opening_balance: v.number(),
  },
  handler: async (ctx, { token, outletId, opened_by_name, opening_balance }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const name = opened_by_name.trim();
    if (!name) throw new Error("Enter the name of the person opening the day");
    if (!Number.isFinite(opening_balance) || opening_balance < 0) {
      throw new Error("Opening balance must be zero or more");
    }
    if (await openSessionFor(ctx, oid)) {
      throw new Error("A day is already open — close it before opening a new one");
    }

    const prev = await ctx.db
      .query("day_sessions")
      .withIndex("by_outlet_status", (q) =>
        q.eq("outlet_id", oid).eq("status", "closed")
      )
      .order("desc")
      .first();
    const suggested = round2(prev?.counted_cash ?? 0);
    const opening = round2(opening_balance);
    const now = Date.now();

    // A mismatch between the carried-in cash and the counted opening is logged
    // as the first correction so the drawer's story stays auditable.
    const corrections =
      opening !== suggested
        ? [
            {
              previous: suggested,
              amount: opening,
              note: "Adjusted while opening the day",
              by_name: name,
              at: now,
            },
          ]
        : [];

    return await ctx.db.insert("day_sessions", {
      outlet_id: oid,
      status: "open",
      opened_at: now,
      opened_by_name: name,
      current_handler_name: name,
      opening_balance: opening,
      suggested_opening: suggested,
      prev_session_id: prev?._id,
      opening_corrections: corrections,
    });
  },
});

export const correctOpeningBalance = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    amount: v.number(),
    note: v.optional(v.string()),
    by_name: v.string(),
  },
  handler: async (ctx, { token, outletId, amount, note, by_name }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const name = by_name.trim();
    if (!name) throw new Error("Enter who is making this correction");
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Corrected opening balance must be zero or more");
    }
    const session = await openSessionFor(ctx, oid);
    if (!session) throw new Error("No day is open");

    const next = round2(amount);
    const previous = round2(session.opening_balance);
    if (next === previous) {
      throw new Error("That is the same as the current opening balance");
    }
    await ctx.db.patch(session._id, {
      opening_balance: next,
      opening_corrections: [
        ...session.opening_corrections,
        {
          previous,
          amount: next,
          note: note?.trim() || undefined,
          by_name: name,
          at: Date.now(),
        },
      ],
    });
    return { opening_balance: next };
  },
});

export const handover = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    from_name: v.string(),
    to_name: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { token, outletId, from_name, to_name, notes }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const to = to_name.trim();
    if (!to) throw new Error("Enter the name of the person taking over");
    const session = await openSessionFor(ctx, oid);
    if (!session) throw new Error("No day is open to hand over");

    const from = from_name.trim() || session.current_handler_name;
    if (from === to) {
      throw new Error("The person taking over must be different from the current handler");
    }

    const lastHandover = await ctx.db
      .query("shift_handovers")
      .withIndex("by_day_session", (q) => q.eq("day_session_id", session._id))
      .order("desc")
      .first();
    const shiftSince = lastHandover?.at ?? session.opened_at;

    const [shift, dayCash, bills] = await Promise.all([
      paymentsSince(ctx, oid, shiftSince),
      paymentsSince(ctx, oid, session.opened_at),
      openBillsFor(ctx, oid),
    ]);
    const open_bills_total = round2(bills.reduce((s, b) => s + b.balance_due, 0));

    await ctx.db.insert("shift_handovers", {
      outlet_id: oid,
      day_session_id: session._id,
      at: Date.now(),
      from_name: from,
      to_name: to,
      notes: notes?.trim() || undefined,
      snapshot: {
        since: shiftSince,
        cash_collected: shift.cash_collected,
        card_collected: shift.card_collected,
        upi_collected: shift.upi_collected,
        online_collected: shift.online_collected,
        total_collected: shift.total_collected,
        orders_count: shift.orders_count,
        open_bills_count: bills.length,
        open_bills_total,
        expected_drawer_cash: round2(
          session.opening_balance + dayCash.cash_collected
        ),
      },
    });
    await ctx.db.patch(session._id, { current_handler_name: to });
    return { to_name: to };
  },
});

export const closeDay = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    counted_cash: v.number(),
    closed_by_name: v.string(),
    carry_over_open_bills: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { token, outletId, counted_cash, closed_by_name, carry_over_open_bills, notes }
  ) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const name = closed_by_name.trim();
    if (!name) throw new Error("Enter who is closing the day");
    if (!Number.isFinite(counted_cash) || counted_cash < 0) {
      throw new Error("Counted cash must be zero or more");
    }
    const session = await openSessionFor(ctx, oid);
    if (!session) throw new Error("No day is open to close");

    const [day, bills] = await Promise.all([
      paymentsSince(ctx, oid, session.opened_at),
      openBillsFor(ctx, oid),
    ]);

    if (bills.length > 0 && !carry_over_open_bills) {
      throw new Error(
        `${bills.length} open bill(s) are still unsettled — settle them first, or choose to carry them over to the next day`
      );
    }

    const expected = round2(session.opening_balance + day.cash_collected);
    const counted = round2(counted_cash);
    const openBillsTotal = round2(bills.reduce((s, b) => s + b.balance_due, 0));

    await ctx.db.patch(session._id, {
      status: "closed",
      closed_at: Date.now(),
      closed_by_name: name,
      counted_cash: counted,
      expected_cash: expected,
      cash_variance: round2(counted - expected),
      carried_over_order_ids: carry_over_open_bills
        ? bills.map((b) => b._id)
        : [],
      carried_over_total: carry_over_open_bills ? openBillsTotal : 0,
      notes: notes?.trim() || undefined,
    });

    return {
      expected_cash: expected,
      counted_cash: counted,
      cash_variance: round2(counted - expected),
      carried_over: carry_over_open_bills ? bills.length : 0,
      carried_over_total: carry_over_open_bills ? openBillsTotal : 0,
    };
  },
});
