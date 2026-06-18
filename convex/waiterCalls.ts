/**
 * Admin/front-of-house side of the customer "call waiter" flow. Reads and
 * writes against the waiter_calls table, scoped per outlet via the caller's
 * session token (never trusting a client-supplied outlet_id).
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

const REASON_LABEL: Record<string, string> = {
  service: "Needs service",
  bill: "Asked for the bill",
  water: "Asked for water",
  other: "Needs help",
};

/**
 * Open (unacknowledged) calls, newest first, enriched with the table number
 * so the front-of-house can route without an extra lookup.
 */
export const listOpen = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const rows = (
      await ctx.db
        .query("waiter_calls")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    ).filter((row) => row.acknowledged_at === undefined);

    rows.sort((a, b) => b.created_at - a.created_at);

    return Promise.all(
      rows.map(async (row) => {
        const table = await ctx.db.get(row.table_id);
        return {
          _id: row._id,
          table_id: row.table_id,
          table_number: table?.table_number ?? "?",
          reason: row.reason,
          reason_label: REASON_LABEL[row.reason] ?? row.reason,
          created_at: row.created_at,
        };
      })
    );
  },
});

/**
 * Open calls grouped by table, for the per-table-card badges. Each entry
 * carries the oldest open call's age so the UI can flag stale requests.
 */
export const openByTable = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const rows = (
      await ctx.db
        .query("waiter_calls")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    ).filter((row) => row.acknowledged_at === undefined);

    const byTable = new Map<
      string,
      { count: number; oldest_created_at: number; reasons: string[] }
    >();
    for (const row of rows) {
      const key = row.table_id as unknown as string;
      const entry = byTable.get(key);
      if (entry) {
        entry.count += 1;
        entry.oldest_created_at = Math.min(entry.oldest_created_at, row.created_at);
        if (!entry.reasons.includes(row.reason)) entry.reasons.push(row.reason);
      } else {
        byTable.set(key, {
          count: 1,
          oldest_created_at: row.created_at,
          reasons: [row.reason],
        });
      }
    }
    return Array.from(byTable.entries()).map(([table_id, info]) => ({
      table_id,
      ...info,
    }));
  },
});

export const acknowledge = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("waiter_calls"),
    acknowledged_by: v.optional(v.id("restaurant_staff")),
  },
  handler: async (ctx, { token, outletId, id, acknowledged_by }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Call not found");
    assertSameOutlet(row, oid);
    if (row.acknowledged_at) return; // already done — no-op
    await ctx.db.patch(id, {
      acknowledged_at: Date.now(),
      acknowledged_by,
    });
  },
});

/**
 * Acknowledge every open call for a given table — useful when the waiter
 * arrives at the table and resolves everything at once. Confined to the
 * caller's outlet.
 */
export const acknowledgeAllForTable = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    table_id: v.id("restaurant_tables"),
    acknowledged_by: v.optional(v.id("restaurant_staff")),
  },
  handler: async (ctx, { token, outletId, table_id, acknowledged_by }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const open = await ctx.db
      .query("waiter_calls")
      .withIndex("by_table", (q) => q.eq("table_id", table_id))
      .filter((q) => q.eq(q.field("acknowledged_at"), undefined))
      .filter((q) => q.eq(q.field("outlet_id"), oid))
      .collect();
    const now = Date.now();
    for (const row of open) {
      await ctx.db.patch(row._id, {
        acknowledged_at: now,
        acknowledged_by,
      });
    }
    return open.length;
  },
});
