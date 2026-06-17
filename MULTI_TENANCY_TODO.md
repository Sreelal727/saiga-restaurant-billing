# Multi-Tenancy — Remaining Work (Resume Checklist)

Status tracker for converting the app to 3 outlets + HQ super admin.
Design doc: `MULTI_TENANCY_PLAN.md`. This file = what's left.

## ⛔ Current blocker
Convex deployments (dev **and** prod) are **disabled — free-plan limit exceeded**.
Nothing further (migration, dev verification, deploy) can run until the plan is
re-enabled.

**Action (owner only):** https://dashboard.convex.dev/t/sreelalvarier727 →
project → Settings → Billing → **Upgrade to Pro** (or email support@convex.dev).
This also restores the live JABAL MANDI app, which is currently down for the
same reason.

## Target outlets & credentials
| Outlet | Login | Notes |
|---|---|---|
| JABAL MANDI (default) | existing `admin` / `test1234` | existing live data migrates here |
| DHK | `DHK` / `DHK786` | new, empty menu |
| Toll Outlet | `Toll` / `Toll786` | new, empty menu |
| Super admin (HQ) | `Nizar` / `Nizar786` | sees all outlets (consolidated) |

- DHK/Toll credentials are created by the migration (stored hashed on the
  `outlets` row).
- **Nizar** is read from Convex env vars — must be set after upgrade:
  `npx convex env set HQ_USERNAME Nizar` and `npx convex env set HQ_PASSWORD Nizar786`
  (run for **both** dev and `--prod`).

## ✅ Done & committed (STAGED — NOT deployed)
- `convex/schema.ts` — `outlets` table; `outlet_id` (optional) on every tenant
  table + indexes; `mobile_sessions.outlet_id`/`is_hq`.
- `convex/migrations.ts` — `setupOutlets` (create outlets, backfill existing rows
  into JABAL, seed per-outlet order counter) + `verify`.
- `convex/lib/sha256.ts` — synchronous SHA-256 (token hashing inside queries).
- `convex/lib/tenant.ts` — `requireOutlet` / `requireHq` / `assertSameOutlet`.
- `convex/auth.ts` — outlet-aware sign-in (admin→JABAL, DHK/Toll outlet logins,
  Nizar HQ); session persists `outlet_id`/`is_hq`; identity returns them.
- `src/components/auth/session-context.tsx` — exposes `token` + outlet fields.
- `src/components/outlet/outlet-context.tsx` — `OutletProvider`, `useOutlet`,
  `useTenant()` (yields `{token, outletId}` for scoped calls).
- `src/providers.tsx` — mounts `OutletProvider`.

## ⏳ Resume sequence (run when Convex is back)
1. **Verify prod live:** `npx convex run settings:get --prod` returns data (JABAL OK).
2. **Migrate dev:** `npx convex dev --once` then `npx convex run migrations:setupOutlets`;
   confirm with `npx convex run migrations:verify` → `total_missing: 0`, 3 outlets.
3. **Set HQ env (dev + prod):** `HQ_USERNAME=Nizar`, `HQ_PASSWORD=Nizar786`.
4. **Scope ONE module end-to-end** (recommend `settings`) on dev, verify the
   pattern (login as DHK, confirm isolation), THEN mass-apply.
5. **Migrate prod:** `npx convex run migrations:setupOutlets --prod` → `verify --prod`.
6. **Deploy** + smoke-test JABAL still works; then DHK/Toll/Nizar logins.

## ⏳ Backend scoping — per module (the big mechanical pass)
Pattern: add `token: v.string()` (+ `outletId: v.id("outlets")` for per-outlet
ops) to args; call `requireOutlet(ctx, token, outletId)`; **read** via `by_outlet*`
indexes; **write** stamps `outlet_id`; **mutate-by-id** does `get` + `assertSameOutlet`.

- [ ] `settings.ts` — get, upsert
- [ ] `categories.ts` — list/create/update/reorder/remove (reorder within outlet)
- [ ] `menu.ts` — list, listWithCategories, listAdmin, create (stamp item + stock), update, remove, bulk*, toggleActive
- [ ] `tables.ts` — list, listWithCurrentOrder, create, update, updateStatus, remove, issueQrToken
- [ ] `orders.ts` — list, listPaginated, get, create (per-outlet counter + stamp items/payments), updateStatus, addItems, addPayment, removePayment, recordPayment, markKotPrinted, updateCharges
- [ ] `inventory.ts` — list, lowStock, update, restock, dump, dumpsRecent, removeDump
- [ ] `staff.ts` — list, create (stamp outlet), update, remove; `auth.setStaffLogin` dupe check
- [ ] `customers.ts` — customers are SHARED; scope per-outlet STATS via `by_outlet_customer` (list/get/findByPhone/findOrCreateByPhone)
- [ ] `reservations.ts` — all + findConflict (within outlet)
- [ ] `waiterCalls.ts` — listOpen, openByTable, acknowledge, acknowledgeAllForTable
- [ ] `dashboard.ts` — stats, recentOrders, revenueByDay, liveTables, activeOrders (per active outlet)
- [ ] `reports.ts` — gstReport (by_outlet_paid_at)
- [ ] `selfOrder.ts` — PUBLIC: derive outlet from `table.outlet_id`; scope menu/settings/order (no token)
- [ ] `mobileApi.ts` + `http.ts` — outlet from verified session; check `table.outlet_id === session.outlet_id`
- [ ] shared: dedupe `nextOrderNumber` (per-outlet) + `round2` into `convex/lib/`

## ⏳ Frontend — thread `useTenant()` + skip-when-not-ready
Replace each `useQuery(api.x.y, {…})` with `useQuery(api.x.y, t.args ? {…t.args, …} : "skip")`
and pass `t.args` to mutations. Pages: dashboard, tables, reservations, orders,
orders/new, orders/[id], menu, inventory, customers, staff, reports, settings,
kitchen. (`order/[token]` self-order = public, no token.)

## ⏳ HQ super admin
- [ ] `convex/hq.ts` — `overview`, `revenueByDayAllOutlets`, `gstConsolidated`, `outletLeaderboard` (all `requireHq`)
- [ ] Outlet switcher in header (HQ only) → sets `selectedOutletId` in OutletProvider
- [ ] Consolidated HQ dashboard page + sidebar gating; HQ with no outlet selected sees consolidated view, not per-outlet pages
- [ ] (Phase 3) Outlets admin UI to add more outlets later

## Notes / gotchas
- Once `settings.upsert` requires token, the earlier CLI calls
  (`npx convex run settings:upsert …`) no longer work without args — set
  per-outlet settings via the app (or an internal migration helper).
- Customers are intentionally **shared** company-wide (phone unique); only stats
  are per-outlet.
- Dev has leftover sample data (KUZHI MANDI + a test order) from print previews —
  harmless; clear if desired.
- Tighten `outlet_id` to required + drop legacy indexes only AFTER everything is
  verified (Phase 3).
