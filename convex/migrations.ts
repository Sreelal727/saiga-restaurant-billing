/**
 * Multi-tenancy Phase 0 migration (run from the CLI, never from the app):
 *
 *   npx convex run migrations:setupOutlets          # dev
 *   npx convex run migrations:setupOutlets --prod   # production
 *
 * Idempotent + additive: creates the three outlets, backfills outlet_id on
 * every existing tenant row into the default (JABAL MANDI) outlet, and seeds
 * the default outlet's per-outlet order-number counter from the current global
 * series so numbering continues with no reset. Re-runnable until `verify`
 * reports zero unstamped rows.
 */
import { internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";
import { sha256Hex } from "./lib/sha256";

// Every tenant-scoped table (NOT restaurant_customers — customers are shared
// company-wide).
const TENANT_TABLES: TableNames[] = [
  "restaurant_settings",
  "restaurant_tables",
  "menu_categories",
  "menu_items",
  "inventory_stock",
  "inventory_dumps",
  "restaurant_staff",
  "restaurant_orders",
  "order_items",
  "restaurant_reservations",
  "order_payments",
  "waiter_calls",
];

const BACKFILL_LIMIT = 2000;

export const setupOutlets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // ── 1. Default outlet (JABAL MANDI) — reuse existing settings name if any.
    let defaultOutlet = await ctx.db
      .query("outlets")
      .withIndex("by_slug", (q) => q.eq("slug", "jabal-mandi"))
      .first();
    if (!defaultOutlet) {
      const settings = (await ctx.db.query("restaurant_settings").collect())[0];
      const id = await ctx.db.insert("outlets", {
        name: settings?.restaurant_name ?? "JABAL MANDI",
        slug: "jabal-mandi",
        is_active: true,
        is_default: true,
        created_at: now,
      });
      defaultOutlet = await ctx.db.get(id);
    }
    const defaultId = defaultOutlet!._id;

    // ── 2. The two new outlets with their login credentials.
    await ensureOutlet(ctx, {
      slug: "dhk",
      name: "DHK",
      username: "dhk",
      password: "DHK786",
      now,
    });
    await ensureOutlet(ctx, {
      slug: "toll",
      name: "Toll Outlet",
      username: "toll",
      password: "Toll786",
      now,
    });

    // ── 3. Backfill outlet_id on existing rows → default outlet.
    const backfilled: Record<string, number> = {};
    for (const table of TENANT_TABLES) {
      const rows = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("outlet_id"), undefined))
        .take(BACKFILL_LIMIT);
      for (const row of rows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch(row._id, { outlet_id: defaultId } as any);
      }
      if (rows.length > 0) backfilled[table] = rows.length;
    }

    // ── 4. Seed the default outlet's order-number counter from the global one.
    const globalCounter = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", "order_number"))
      .first();
    const baseValue = globalCounter?.value ?? 0;
    const defKey = `order_number:${defaultId}`;
    const existing = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", defKey))
      .first();
    if (!existing) {
      await ctx.db.insert("counters", { key: defKey, value: baseValue });
    } else if (existing.value < baseValue) {
      await ctx.db.patch(existing._id, { value: baseValue });
    }

    return {
      default_outlet_id: defaultId,
      backfilled,
      counter_seeded_to: baseValue,
    };
  },
});

async function ensureOutlet(
  ctx: MutationCtx,
  opts: { slug: string; name: string; username: string; password: string; now: number }
): Promise<void> {
  const existing = await ctx.db
    .query("outlets")
    .withIndex("by_slug", (q) => q.eq("slug", opts.slug))
    .first();
  const password_hash = sha256Hex(opts.password);
  if (existing) {
    await ctx.db.patch(existing._id, {
      name: opts.name,
      username: opts.username,
      password_hash,
      is_active: true,
    });
  } else {
    await ctx.db.insert("outlets", {
      name: opts.name,
      slug: opts.slug,
      is_active: true,
      created_at: opts.now,
      username: opts.username,
      password_hash,
    });
  }
}

/**
 * Set the per-outlet bill address for the DHK and Toll outlets (idempotent).
 * Creates a settings row from the default outlet's template if one doesn't
 * exist yet, otherwise just patches the address.
 *
 *   npx convex run migrations:setOutletAddresses --prod
 */
export const setOutletAddresses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const updates = [
      {
        slug: "dhk",
        address: "DHK Malabar Plaza, 62/741 A, Darbar Hall Road, Pallimukku, Kochi",
      },
      {
        slug: "toll",
        address: "Malabar Plaza, 33/692, Toll Junction, Edappally, Kochi, 682024",
      },
    ];

    // Use the default outlet's settings as a template for any missing fields.
    const defaultOutlet = await ctx.db
      .query("outlets")
      .withIndex("by_slug", (q) => q.eq("slug", "jabal-mandi"))
      .first();
    const template = defaultOutlet
      ? await ctx.db
          .query("restaurant_settings")
          .withIndex("by_outlet", (q) => q.eq("outlet_id", defaultOutlet._id))
          .first()
      : null;

    const result: Record<string, string> = {};
    for (const u of updates) {
      const outlet = await ctx.db
        .query("outlets")
        .withIndex("by_slug", (q) => q.eq("slug", u.slug))
        .first();
      if (!outlet) {
        result[u.slug] = "outlet not found";
        continue;
      }
      const existing = await ctx.db
        .query("restaurant_settings")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", outlet._id))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { address: u.address });
        result[u.slug] = "updated";
      } else {
        await ctx.db.insert("restaurant_settings", {
          outlet_id: outlet._id,
          restaurant_name: template?.restaurant_name ?? "JABAL MANDI",
          address: u.address,
          phone: template?.phone,
          cgst_rate: template?.cgst_rate ?? 2.5,
          sgst_rate: template?.sgst_rate ?? 2.5,
          default_packing_charge: template?.default_packing_charge ?? 0,
          default_delivery_charge: template?.default_delivery_charge ?? 0,
          currency: template?.currency ?? "INR",
          bill_paper_width: template?.bill_paper_width ?? 58,
        });
        result[u.slug] = "created";
      }
    }
    return result;
  },
});

/** Report unstamped (outlet_id missing) row counts per tenant table. */
export const verify = internalQuery({
  args: {},
  handler: async (ctx) => {
    const result: Record<string, number> = {};
    let totalMissing = 0;
    for (const table of TENANT_TABLES) {
      const missing = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("outlet_id"), undefined))
        .take(BACKFILL_LIMIT + 1);
      if (missing.length > 0) result[table] = missing.length;
      totalMissing += missing.length;
    }
    const outlets = await ctx.db.query("outlets").collect();
    return {
      total_missing: totalMissing,
      missing_by_table: result,
      outlets: outlets.map((o) => ({
        name: o.name,
        slug: o.slug,
        is_default: o.is_default ?? false,
        has_login: !!o.username,
      })),
    };
  },
});
