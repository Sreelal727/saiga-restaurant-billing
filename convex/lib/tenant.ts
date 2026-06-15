/**
 * Server-side multi-tenant enforcement.
 *
 * Every tenant-scoped query/mutation receives the caller's opaque session
 * `token` and resolves the bound outlet HERE, against the DB — never trusting a
 * client-supplied outlet_id. The token is hashed with the synchronous SHA-256
 * (Web Crypto isn't available in the query/mutation isolate) and matched to a
 * live `mobile_sessions` row.
 *
 * - Outlet manager/staff session → { outletId, isHq:false }
 * - HQ / super-admin session      → { outletId:null, isHq:true } (sees all)
 */
import { QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { sha256Hex } from "./sha256";

export interface TenantContext {
  outletId: Id<"outlets"> | null;
  isHq: boolean;
  staffId: Id<"restaurant_staff"> | null;
  username: string;
}

/** Resolve + verify the session token. Throws when missing/invalid/revoked. */
export async function resolveSession(
  ctx: QueryCtx,
  token: string
): Promise<TenantContext> {
  if (!token) throw new Error("Not signed in");
  const token_hash = sha256Hex(token);
  const session = await ctx.db
    .query("mobile_sessions")
    .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
    .first();
  if (!session || session.revoked_at !== undefined) {
    throw new Error("Session expired — please sign in again");
  }
  return {
    outletId: session.outlet_id ?? null,
    isHq: session.is_hq === true,
    staffId: session.staff_id,
    username: session.username,
  };
}

/**
 * For outlet-scoped operations. Returns the concrete outlet to act on:
 * - A normal session uses its own bound outlet.
 * - An HQ session may pass an explicit `outletId` to act within one outlet
 *   (e.g. the HQ user drilling into an outlet); without one it throws, so
 *   HQ-only consolidated reads must use `requireHq` instead.
 */
export async function requireOutlet(
  ctx: QueryCtx,
  token: string,
  outletIdArg?: Id<"outlets"> | null
): Promise<{ outletId: Id<"outlets">; ctx: TenantContext }> {
  const tenant = await resolveSession(ctx, token);
  if (tenant.isHq) {
    if (!outletIdArg) {
      throw new Error("HQ session must select an outlet for this action");
    }
    return { outletId: outletIdArg, ctx: tenant };
  }
  if (!tenant.outletId) {
    throw new Error("This account is not assigned to an outlet");
  }
  // A non-HQ caller may never act on another outlet, even if it passes one.
  if (outletIdArg && outletIdArg !== tenant.outletId) {
    throw new Error("Cross-outlet access denied");
  }
  return { outletId: tenant.outletId, ctx: tenant };
}

/** For consolidated/HQ-only reads across all outlets. */
export async function requireHq(ctx: QueryCtx, token: string): Promise<TenantContext> {
  const tenant = await resolveSession(ctx, token);
  if (!tenant.isHq) throw new Error("HQ access only");
  return tenant;
}

/** Guard a fetched document against cross-outlet access before mutating it. */
export function assertSameOutlet(
  doc: { outlet_id?: Id<"outlets"> } | null,
  outletId: Id<"outlets">
): void {
  if (!doc) throw new Error("Not found");
  if (doc.outlet_id && doc.outlet_id !== outletId) {
    throw new Error("Cross-outlet access denied");
  }
}
