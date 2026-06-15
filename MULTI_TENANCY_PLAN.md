# Multi-Tenancy Plan — Saiga Restaurant Billing

Convert the single-restaurant Convex + Next.js app into a multi-outlet system where many outlets of one company share one deployment, each fully isolated, with an HQ owner role seeing a consolidated cross-outlet view. The live "JABAL MANDI" data migrates into a default outlet with zero loss.

## 1. Current architecture (grounding)

- **Backend**: Convex. Schema in `convex/schema.ts`; one function module per domain (`orders.ts`, `menu.ts`, `tables.ts`, `inventory.ts`, `customers.ts`, `reservations.ts`, `categories.ts`, `staff.ts`, `settings.ts`, `dashboard.ts`, `reports.ts`, `waiterCalls.ts`, `selfOrder.ts`, `mobileApi.ts`, `auth.ts`, `http.ts`).
- **Settings is a singleton**: `convex/settings.ts` `get`/`upsert` use `ctx.db.query("restaurant_settings").collect()` and take `rows[0]`. Holds `restaurant_name`, `address`, GST rates, `bill_paper_width`, currency.
- **Order numbers** are a single global counter: `counters` table, key `"order_number"`. `nextOrderNumber()` is duplicated in `orders.ts`, `selfOrder.ts`, and `mobileApi.ts`, all reading the same key.
- **Auth, today**: Token-based. `auth.signIn` (action) checks credentials (admin via `ADMIN_PASSWORD` env, or staff `username`+`pin` in `restaurant_staff`), mints a token, stores SHA-256 hash in `mobile_sessions`, returns `{token, identity}`. The web SPA (`src/components/auth/session-context.tsx`) stores only the token in `localStorage` and re-validates via `auth.validateSession`.
- **CRITICAL FINDING — data functions are unauthenticated**: `src/providers.tsx` uses plain `ConvexProvider`, not `ConvexProviderWithAuth`. The session is a client-side concern only. Every query/mutation in `orders.ts`, `menu.ts`, etc. takes **no identity** and reads/writes the whole table. There is no server-side `ctx.auth`. This is the core thing multi-tenancy must change: the outlet binding must be **proven server-side**, not passed as a trusted client arg.
- **QR self-order** (`convex/selfOrder.ts`): unauthenticated; resolves the table from `restaurant_tables.by_qr_token`. The qr_token is the only gate. Outlet must be derived from the table.
- **Mobile (Flutter)** (`convex/http.ts` + `convex/mobileApi.ts`): Bearer token → `mobile_sessions` hash → `requireSession`. Internal queries/mutations (`home`, `menu`, `createOrAppend`, etc.) currently read whole tables.

### Tables today and scoping decision

| Table | Scope | Notes |
|---|---|---|
| `restaurant_settings` | **per-outlet** | Becomes one row per outlet (name/address/GST/paper width). |
| `restaurant_tables` | per-outlet | Carries `qr_token` (self-order entry → outlet). |
| `menu_categories` | per-outlet | Each outlet its own menu. |
| `menu_items` | per-outlet | Variants/open_price/inventory flags stay per-item. |
| `inventory_stock` | per-outlet | Per-outlet stock (derivable via menu_item but add direct `outlet_id` for fast scans). |
| `inventory_dumps` | per-outlet | Wastage reporting per outlet. |
| `restaurant_staff` | per-outlet (+ HQ) | Staff belong to an outlet; HQ owner is special (see §3). |
| `restaurant_customers` | **global / shared** (recommended) | Phone unique company-wide; reporting filters by order outlet. See §8. |
| `restaurant_orders` | per-outlet | Order-number series per outlet. |
| `order_items` | per-outlet (denormalized) | Add `outlet_id` to avoid join-to-order on hot paths. |
| `restaurant_reservations` | per-outlet | Scoped via table. |
| `order_payments` | per-outlet (denormalized) | Needed for per-outlet GST/payment reports via `by_paid_at`. |
| `counters` | per-outlet | Key becomes `order_number:{outletId}`. |
| `waiter_calls` | per-outlet (denormalized) | Scoped via table. |
| `self_order_rate_limits` | keyed by qr_token | Already effectively per-table; leave as-is. |
| `mobile_sessions` | gains `outlet_id` + `is_hq` | Binds a session/device to an outlet. |
| `login_attempts` | global | Username throttle; leave global (or key by outlet later). |
| **`outlets`** (NEW) | global registry | The tenant root. |

## 2. Data model changes

### New `outlets` table

```ts
outlets: defineTable({
  name: v.string(),            // "JABAL MANDI"
  slug: v.string(),            // url-safe, unique, e.g. "jabal-mandi"
  is_active: v.boolean(),
  created_at: v.number(),
}).index("by_slug", ["slug"]),
```

### Add `outlet_id` to every tenant-scoped table

Add `outlet_id: v.optional(v.id("outlets"))` (nullable in Phase 0; tightened to required in a later phase). For each table add a `by_outlet` index and convert existing single-column indexes that are queried on hot paths into **compound indexes prefixed by `outlet_id`** so scoped queries stay index-driven:

| Table | New index(es) |
|---|---|
| `restaurant_orders` | `by_outlet_status` `["outlet_id","status"]`, `by_outlet_paid_at` `["outlet_id","paid_at"]`, `by_outlet_order_number` `["outlet_id","order_number"]`, `by_outlet_customer` `["outlet_id","customer_id"]`. Keep old indexes during migration; HQ reports can still use `by_paid_at`. |
| `order_items` | `by_outlet` (denormalized); keep `by_order`, `by_menu_item`. |
| `order_payments` | `by_outlet_paid_at` `["outlet_id","paid_at"]`; keep `by_order`. |
| `menu_categories` | `by_outlet_display_order` `["outlet_id","display_order"]`. |
| `menu_items` | `by_outlet_category` `["outlet_id","category_id"]`, `by_outlet_active` `["outlet_id","is_active"]`. |
| `inventory_stock` | `by_outlet`, keep `by_menu_item`. |
| `inventory_dumps` | `by_outlet_dumped_at` `["outlet_id","dumped_at"]`. |
| `restaurant_tables` | `by_outlet`, `by_outlet_status`. `by_qr_token` stays (qr_token globally unique → resolves outlet). |
| `restaurant_staff` | `by_outlet`; `by_username` must become **outlet-unique** — see §3 risk. |
| `restaurant_reservations` | `by_outlet_scheduled_at`, `by_outlet_status`. |
| `waiter_calls` | `by_outlet`, `by_outlet_acknowledged_at`. |
| `counters` | key changes to `order_number:{outletId}`; `by_key` index unchanged. |
| `restaurant_settings` | `by_outlet` (one row per outlet). |
| `mobile_sessions` | add `outlet_id: v.optional(v.id("outlets"))` and `is_hq: v.optional(v.boolean())`; add `by_outlet`. |

Convex preserves existing data on schema deploys as long as new fields are optional — this is the basis for the phased rollout (Phase 0 adds optional fields; data is untouched).

### Per-outlet counter

Replace the three copies of `nextOrderNumber(ctx)` with a single shared helper, e.g. `convex/lib/orderNumber.ts`:

```ts
export async function nextOrderNumber(ctx: MutationCtx, outletId: Id<"outlets">): Promise<string> {
  const key = `order_number:${outletId}`;
  const counter = await ctx.db.query("counters").withIndex("by_key", q => q.eq("key", key)).first();
  const next = (counter?.value ?? 0) + 1;
  if (counter) await ctx.db.patch(counter._id, { value: next });
  else await ctx.db.insert("counters", { key, value: next });
  return `ORD-${String(next).padStart(5, "0")}`;
}
```

Optionally prefix the number with an outlet code (`JM-ORD-00001`) so paper bills are unambiguous across outlets; keep it configurable per outlet (add `order_prefix` to `outlets` or `restaurant_settings`).

## 3. Auth & access control

The central problem: data functions currently receive no server-verified identity. We must route the proven outlet into every function. Recommended approach (least churn, most secure): **Convex auth via JWT** so `ctx.auth.getUserIdentity()` works server-side, OR a **server-resolved session arg pattern**. Given the existing token-in-`mobile_sessions` design, the pragmatic path is:

### Device-pinned-to-outlet model

1. Add `outlet_id` and `is_hq` to `mobile_sessions`. At `signIn`, resolve which outlet the credentials belong to:
   - Staff → `restaurant_staff.outlet_id`.
   - Admin (`ADMIN_PASSWORD`) → keep as a per-outlet admin OR promote to HQ. Recommend introducing a distinct **HQ owner** credential (`HQ_PASSWORD` env or an `outlets`-independent owner record) that mints `is_hq=true` sessions.
2. For the **billing device** (one device = one outlet), the outlet is fixed by the staff/admin account that logged in. The session row carries `outlet_id`; the device cannot act on another outlet.
3. Move data functions behind a **verified-session wrapper**. Two viable mechanisms:
   - **(Preferred) Convex Auth / JWT**: issue a JWT at login encoding `outlet_id` and `is_hq`; switch `providers.tsx` to `ConvexProviderWithAuth`; every query/mutation calls a helper `requireOutlet(ctx)` that reads `ctx.auth.getUserIdentity()` and returns the bound `outlet_id`. The client cannot forge it (signed token).
   - **(Lower-effort interim) Session-token arg validated server-side**: each query/mutation takes `sessionToken: v.string()`; a shared `requireOutlet(ctx, token)` hashes it, looks up `mobile_sessions`, returns `{outlet_id, identity, is_hq}` or throws. The token is opaque and DB-checked, so it is not a trusted client claim — it is verified every call. This mirrors the existing `requireSession` in `http.ts`/`mobileApi.ts`. Downside: token must thread through `useQuery` args (more frontend churn) and queries can't be reactive on a missing token; mitigated by the session context already holding the token.

   Recommendation: go with JWT/`ConvexProviderWithAuth` for the long term; if timeline is tight, ship the interim arg-based pattern in Phase 1 and migrate to JWT in a follow-up. Both enforce server-side; neither trusts a raw `outlet_id` arg.

### Enforcement helper (the pattern every function adopts)

```ts
// convex/lib/tenant.ts
export async function requireOutlet(ctx): Promise<{ outletId: Id<"outlets">; isHq: boolean; identity: Identity }> { ... }
export async function requireHq(ctx) { const c = await requireOutlet(ctx); if (!c.isHq) throw new Error("HQ only"); return c; }
export function assertSameOutlet(doc, outletId) { if (doc.outlet_id !== outletId) throw new Error("Cross-outlet access denied"); }
```

Every scoped read uses `by_outlet*` indexes filtered to `outletId`. Every scoped write stamps `outlet_id: outletId`. Every mutation that takes a document id (e.g. `orders.updateStatus`, `tables.update`, `inventory.restock`, `menu.update`) **must `ctx.db.get` then `assertSameOutlet`** before patching — this closes the cross-outlet ID-guessing hole (Convex ids are opaque but must not be trusted across tenants).

### Roles

- Existing roles `manager | cashier | waiter` stay **outlet-scoped**.
- New **HQ owner** role (`is_hq`): not tied to an outlet; can read consolidated dashboards/reports across all outlets; cannot place orders (or can, only when impersonating a chosen outlet). HQ-only Convex functions call `requireHq`.
- Sidebar (`src/components/layout/sidebar.tsx`) `Role` type extends to surface HQ-only nav (Consolidated Dashboard, Cross-Outlet Reports, Outlet management). Per-outlet nav hidden for pure HQ sessions unless an outlet is selected.

### Customer QR portal

`selfOrder.ts` derives the outlet from the table: `tableByToken` → `table.outlet_id`. All settings/menu/order reads inside `getContext` and `submit` must be scoped to `table.outlet_id` (currently they read the global singleton settings and all active menu items). No auth change needed — qr_token remains the gate; outlet is a property of the resolved table.

### Mobile API

`http.ts` `requireSession` already returns the session; extend it to also return `outlet_id`/`is_hq` from the session row. Every `internal.mobileApi.*` query/mutation gains an `outlet_id` arg supplied by the HTTP layer from the verified session (never from the request body). `home`, `menu`, `createOrAppend`, `orderDetail`, etc. scope by it.

## 4. Query/mutation refactor

Pattern: **read** = resolve outlet → query `by_outlet*` index; **write** = resolve outlet → stamp `outlet_id`; **mutate-by-id** = get doc → `assertSameOutlet` → patch.

Functions that change (non-exhaustive, by file):

- `settings.ts`: `get`/`upsert` become per-outlet (query `by_outlet`, upsert the outlet's row).
- `orders.ts`: `list`, `listPaginated`, `get`, `create`, `updateStatus`, `addPayment`, `removePayment`, `recordPayment`, `addItems`, `markKotPrinted`, `updateCharges`. `create` stamps `outlet_id` and uses per-outlet `nextOrderNumber`. `order_items`/`order_payments` inserts stamp `outlet_id`.
- `menu.ts`: `list`, `listWithCategories`, `listAdmin`, `create`, `update`, `remove`, `bulkRemove`, `bulkSetActive`, `toggleActive`. `create` stamps outlet on item + its `inventory_stock`.
- `categories.ts`: `list`, `listWithCounts`, `create`, `update`, `reorder`, `remove` — scope to outlet (reorder must only swap within the outlet).
- `tables.ts`: `list`, `listWithCurrentOrder`, `create`, `update` (dupe check within outlet only), `updateStatus`, `remove`, `issueQrToken`.
- `inventory.ts`: `list`, `lowStock`, `update`, `restock`, `dump`, `dumpsRecent`, `removeDump` — scope by outlet.
- `customers.ts`: `list`, `listWithStats`, `get`, `findByPhone`, `findOrCreateByPhone`, `create`, `update`, `remove` — see §8 (shared customers, per-outlet stats).
- `reservations.ts`: all queries/mutations + `findConflict` scope by outlet.
- `staff.ts`: `list`, `create`, `update`, `remove` scope by outlet; `auth.setStaffLogin` username uniqueness within outlet.
- `waiterCalls.ts`: `listOpen`, `openByTable`, `acknowledge`, `acknowledgeAllForTable` scope by outlet.
- `dashboard.ts`: `stats`, `recentOrders`, `revenueByDay`, `liveTables`, `activeOrders` scope by current outlet (these become the per-outlet dashboard).
- `reports.ts`: `gstReport` scoped to outlet via `by_outlet_paid_at`.
- `selfOrder.ts`: outlet from table (§3).
- `mobileApi.ts` + `http.ts`: outlet from verified session (§3).
- Shared helper extraction: dedupe `nextOrderNumber` and `round2` into `convex/lib/`.

## 5. Consolidated HQ dashboard + reports

New module `convex/hq.ts`, all functions gated by `requireHq`:

- `hq.overview` — iterate `outlets` (active); for each run the existing per-outlet aggregations (today revenue, active orders, occupied tables, low stock) and return `{ totals, perOutlet: [...] }`.
- `hq.revenueByDayAllOutlets` — per-outlet `by_outlet_paid_at` rollups merged into a stacked-by-outlet series.
- `hq.gstConsolidated(from,to)` — loop outlets, reuse `reports.gstReport` logic per outlet, return company total + per-outlet breakdown + per-payment-method.
- `hq.outletLeaderboard` — rank outlets by revenue/orders for a window.

Because totals fan out over outlets, keep windows bounded (reuse the existing `by_*paid_at` index pattern) and cap how many orders are scanned. HQ functions never accept an `outlet_id` from an untrusted client to *narrow* in a way that leaks — they always start from the `outlets` registry.

Frontend: new HQ-only pages under e.g. `src/app/(hq)/...` (or gated routes in `(app)`) wired to `api.hq.*`, with a per-outlet breakdown table and a company-wide total card.

## 6. Migration (live "JABAL MANDI" data)

Run as an `internalMutation` (`convex/migrations.ts`) invoked via `npx convex run`:

1. **Create default outlet**: insert `outlets { name: "JABAL MANDI", slug: "jabal-mandi", is_active: true }`. Capture its `_id`.
2. **Backfill `outlet_id`** on every existing row of every scoped table (`restaurant_orders`, `order_items`, `order_payments`, `menu_categories`, `menu_items`, `inventory_stock`, `inventory_dumps`, `restaurant_tables`, `restaurant_staff`, `restaurant_reservations`, `waiter_calls`, `restaurant_settings`) → set to the default outlet id. Idempotent: skip rows already stamped. Batch with cursors to respect Convex mutation limits (process N rows per call, re-invoke until none left).
3. **Settings singleton**: the one `restaurant_settings` row gets `outlet_id = default`. (If somehow >1 exists, keep `rows[0]`, log the rest.)
4. **Counter**: read existing `counters` key `"order_number"` value V; insert/patch `order_number:{defaultOutletId}` = V; leave or delete the legacy key after cutover. This guarantees the next order number continues the existing series (no reset, no collision).
5. **Sessions/staff**: existing `restaurant_staff` rows → default outlet. Existing `mobile_sessions` rows → set `outlet_id = default`, `is_hq=false`. (Or force re-login at cutover to mint outlet-bound sessions.)
6. **Verification query** (`migrations.verify`): assert zero rows with `outlet_id == undefined` across all scoped tables before enforcing required (Phase 1).

Safety: Phase 0 keeps `outlet_id` optional and old indexes intact, so this backfill runs against live prod with the app fully functional; nothing breaks if it runs in multiple passes.

## 7. Frontend

- **Outlet context provider** (`src/components/outlet/outlet-context.tsx`): exposes `currentOutlet` derived from the session (the device is pinned). For HQ sessions, exposes an outlet **switcher** (dropdown) that selects which outlet the per-outlet pages operate on; persists selection.
- **Header** (`src/components/layout/header.tsx`): show current outlet name (and, for HQ, the switcher).
- **Sidebar** (`src/components/layout/sidebar.tsx`): add HQ-only items (Consolidated Dashboard, Cross-Outlet Reports, Outlets admin); hide outlet-scoped items for pure-HQ until an outlet is chosen.
- **Auth/session** (`src/components/auth/session-context.tsx`): extend `Session`/`Identity` with `outlet_id` and `is_hq` (returned by `auth.signIn`/`validateSession`). If using the interim token-arg pattern, thread the token into `useQuery`/`useMutation` calls; if JWT, switch `providers.tsx` to `ConvexProviderWithAuth` and the queries read identity server-side (no per-call arg).
- **Per-outlet settings UI**: `src/app/(app)/settings/page.tsx` already edits name/address/GST/`bill_paper_width`; it now edits the **current outlet's** settings row. No UI redesign needed — just scoped data.
- **Bill/KOT printing**: `orders/[id]/page.tsx` and `orders/new/page.tsx` read `api.settings.get` for name/address/`bill_paper_width`; once `settings.get` is outlet-scoped, printing is automatically per-outlet. Confirm the print component pulls the outlet's settings, not a global.

## 8. Interactions with recent features (confirm per-outlet)

- **Portions/variants & open-price ("as per size")**: live on `menu_items`, which is outlet-scoped → automatically per-outlet. `resolveOrderLine` (orders.ts) and `selfOrder.submit` re-derive price from the item; no change beyond scoping the item lookup. Self-order continues to hide `open_price` items.
- **Thermal printing (58/80mm, name/address)**: now reads the outlet's `restaurant_settings` row → per-outlet. ✅
- **Quick Actions tab** (`src/app/(app)/quick-actions/page.tsx`, `src/components/quick-actions/quick-actions.tsx`): operates on the current outlet's tables/orders/menu → per-outlet once underlying queries are scoped. ✅
- **KOT batching** (`kot_count`, `kot_batch`): per-order, unaffected, but order is outlet-scoped. ✅

## 9. Risks & edge cases

- **Order-number collisions**: solved by per-outlet counter key `order_number:{outletId}`. Migration seeds each outlet's counter from its current max so the live series continues. The `by_outlet_order_number` index makes lookups unambiguous.
- **Cross-outlet access via guessed ids**: every mutate-by-id path must `get` + `assertSameOutlet`. This is the most error-prone part — audit each `v.id(...)` mutation arg.
- **Staff username uniqueness**: today `by_username` is global. Two outlets may both want `manager`/`cashier1`. Decide: (a) keep usernames globally unique (simplest, login resolves outlet from staff row), or (b) make `(outlet_id, username)` unique and require outlet selection at login. Recommend (a) for now — login stays a single lookup and the session inherits the staff's outlet. The `setStaffLogin` dupe check must remain global under (a).
- **QR self-order**: outlet comes from the table; a leaked qr_token still only exposes its own outlet. Rate-limit row is per-token. ✅
- **Flutter mobile API**: outlet must come from the **verified session**, never the request body, or a waiter could post another outlet's `table_id`. Add a server check that `table.outlet_id === session.outlet_id` in `createOrAppend`/`sendKot`/`updateOrderStatus`/`ackCall`.
- **Inventory per outlet**: each outlet has its own `inventory_stock` rows (one per its own menu_item). Deduction paths in `orders.ts`, `selfOrder.ts`, `mobileApi.ts` already key off `menu_item_id`, which is outlet-scoped → correct, but add `outlet_id` to stock rows for fast per-outlet scans (`inventory.list`, `lowStock`, dashboard `low_stock_count`).
- **Customers shared vs per-outlet** (recommend **shared/global**): a regular who visits two outlets is one record; phone stays globally unique (matches current `by_phone`). Per-outlet stats (`listWithStats`, `get`) compute spend/order counts by filtering the customer's orders to the current outlet via `by_outlet_customer`. HQ can show company-wide customer value. If the owner insists on isolation, switch to `(outlet_id, phone)` unique — but shared is the better product fit and less migration risk.
- **Reservation/table scoping**: reservations scope via their table's outlet; `findConflict` only considers same-outlet reservations (already keyed by `table_id`, which is outlet-scoped). Add `outlet_id` for direct windowed queries.
- **Partial-migration safety**: optional `outlet_id` + retained legacy indexes mean the app runs correctly mid-backfill. Don't enforce `requireOutlet` until backfill `verify` passes.
- **Rollback**: Phases 0–1 are reversible — Phase 0 only adds optional fields/indexes (no behavior change); enforcement (Phase 1) is a code deploy that can be reverted to the pre-enforcement build. Keep legacy indexes until Phase 3 to allow instant revert.

## 10. Phased rollout

### Phase 0 — Additive schema + backfill (S–M) — no behavior change
- [ ] Add `outlets` table + `outlet_id` (optional) + `is_hq`/`outlet_id` on `mobile_sessions` in `convex/schema.ts`; add `by_outlet*` indexes alongside existing ones.
- [ ] Write `convex/migrations.ts`: create default outlet, batched idempotent backfill, counter seed, `verify`.
- [ ] Run against prod; confirm `verify` reports zero unstamped rows.
- **Verify**: app still works unchanged; every row has `outlet_id`.

### Phase 1 — Enforce scoping (L) — independently deployable per module
- [ ] Add `convex/lib/tenant.ts` (`requireOutlet`/`requireHq`/`assertSameOutlet`) and shared `nextOrderNumber`/`round2`.
- [ ] Extend `auth.signIn`/`validateSession`/`mobileApi.issueSession`/`sessionByHash` to return + persist `outlet_id`/`is_hq`.
- [ ] Choose enforcement transport (JWT via `ConvexProviderWithAuth` preferred; interim token-arg fallback).
- [ ] Refactor each module (§4) to scope reads/writes and assert same-outlet on id mutations. Ship module-by-module behind the wrapper.
- [ ] Scope `selfOrder.ts` to `table.outlet_id`; scope `mobileApi`/`http.ts` to session outlet + table-outlet check.
- **Verify**: cross-outlet read/write attempts throw; per-outlet order numbers increment independently; QR and mobile flows stay outlet-correct.

### Phase 2 — HQ consolidated views (M)
- [ ] `convex/hq.ts` (`overview`, `revenueByDayAllOutlets`, `gstConsolidated`, `outletLeaderboard`) gated by `requireHq`.
- [ ] HQ frontend pages + outlet switcher + sidebar gating; HQ login/owner credential.
- **Verify**: HQ sees per-outlet breakdown + company totals; non-HQ blocked.

### Phase 3 — Outlet self-service + cleanup (S–M)
- [ ] Outlets admin UI (create/rename/activate) for HQ; per-outlet `order_prefix`.
- [ ] Tighten `outlet_id` to required in schema; drop now-unused legacy single-column indexes; remove legacy `order_number` counter key.
- **Verify**: new outlet can be created and immediately operate isolated; reports unaffected.

### Effort summary

| Phase | Scope | Effort |
|---|---|---|
| 0 | Additive schema + backfill migration | S–M |
| 1 | Server-side enforcement + per-module refactor + auth outlet-binding | L |
| 2 | HQ dashboard/reports + frontend gating | M |
| 3 | Outlet admin + required-field tightening + index cleanup | S–M |

## 11. Critical files for implementation
- `convex/schema.ts`
- `convex/orders.ts`
- `convex/auth.ts`
- `convex/selfOrder.ts`
- `convex/http.ts` (with `convex/mobileApi.ts`)

## 12. Executive summary
- Introduce a global `outlets` table and stamp `outlet_id` on every tenant-scoped table; make `restaurant_settings` and the order-number `counters` key per-outlet so each outlet has its own menu, tables, orders, billing, inventory, staff, settings, and order series.
- The decisive risk is that data functions today run with **no server-verified identity** (plain `ConvexProvider`); multi-tenancy requires the outlet to be derived/enforced server-side (JWT via `ConvexProviderWithAuth`, or a DB-validated session token), never trusted as a client-passed `outlet_id`.
- Bind sessions/devices to an outlet via `mobile_sessions.outlet_id`; add an HQ owner role (`is_hq`) for consolidated cross-outlet dashboards/reports, with QR self-order resolving outlet from the table's `qr_token` and the Flutter API resolving it from the verified session.
- Migrate live "JABAL MANDI" data with an idempotent, batched backfill into a default outlet, seeding its counter from the current max order number so the series continues with zero loss or collision.
- Roll out in safe, reversible phases — Phase 0 additive schema + backfill (no behavior change), Phase 1 enforce scoping module-by-module, Phase 2 HQ views, Phase 3 outlet self-service and cleanup — keeping legacy indexes until enforcement is proven.
