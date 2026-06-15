import { action, internalMutation, internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/sha256";

/**
 * Web auth:
 *  - `signIn` (action): checks credentials, mints a random token, stores its
 *    SHA-256 hash in `mobile_sessions`, returns `{token, identity}` once. The
 *    raw token never returns to the DB.
 *  - `validateSession` (action): hashes the supplied token, looks up the row,
 *    returns the identity. Admin sessions are no longer trusted from a
 *    client-supplied `is_admin` flag — every "I'm admin" claim must match a
 *    real session row issued by `signIn`.
 *
 * Two flows for credentials:
 *  - Admin: username "admin" (or `ADMIN_USERNAME` env var) + `ADMIN_PASSWORD`.
 *    The deployment refuses admin logins until that env var is set.
 *  - Staff: a row in `restaurant_staff` with a matching `username` + 4-digit `pin`.
 */

// ─── Token helpers (action-only — crypto.subtle is async) ─────────────────────

function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// ─── Public identity shape ────────────────────────────────────────────────────

export type Identity = {
  staff_id: Id<"restaurant_staff"> | null;
  name: string;
  username: string;
  role: "manager" | "cashier" | "waiter";
  is_admin: boolean;
  // Multi-tenancy: the outlet this identity is bound to (null for HQ/super
  // admin, who can see all outlets), and whether this is the HQ super admin.
  outlet_id: Id<"outlets"> | null;
  is_hq: boolean;
  outlet_name: string | null;
};

/** The original (default) outlet — JABAL MANDI. Admin login maps here. */
async function defaultOutlet(ctx: QueryCtx): Promise<Doc<"outlets"> | null> {
  const bySlug = await ctx.db
    .query("outlets")
    .withIndex("by_slug", (q) => q.eq("slug", "jabal-mandi"))
    .first();
  if (bySlug) return bySlug;
  const all = await ctx.db.query("outlets").collect();
  return all.find((o) => o.is_default) ?? all[0] ?? null;
}

// ─── Internal queries / mutations the actions delegate to ─────────────────────

export const _checkCredentials = internalQuery({
  args: { username: v.string(), secret: v.string() },
  handler: async (ctx, { username, secret }): Promise<Identity | null> => {
    const normalized = username.trim().toLowerCase();
    if (normalized.length === 0 || secret.length === 0) return null;

    // 1. HQ super admin (sees all outlets). Credentials from env.
    const hqUser = (process.env.HQ_USERNAME ?? "nizar").toLowerCase();
    const hqPass = process.env.HQ_PASSWORD;
    if (normalized === hqUser) {
      if (!hqPass || secret !== hqPass) return null;
      return {
        staff_id: null,
        name: "Super Admin",
        username: hqUser,
        role: "manager" as const,
        is_admin: true,
        outlet_id: null,
        is_hq: true,
        outlet_name: null,
      };
    }

    // 2. Legacy admin login → the default (JABAL MANDI) outlet.
    const adminUser = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;
    if (normalized === adminUser) {
      if (!adminPass || secret !== adminPass) return null;
      const def = await defaultOutlet(ctx);
      return {
        staff_id: null,
        name: "Administrator",
        username: adminUser,
        role: "manager" as const,
        is_admin: true,
        outlet_id: def?._id ?? null,
        is_hq: false,
        outlet_name: def?.name ?? null,
      };
    }

    // 3. Outlet login (DHK, Toll, …) — username + password stored on the outlet.
    const outlet = await ctx.db
      .query("outlets")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .first();
    if (outlet) {
      if (!outlet.is_active || !outlet.password_hash) return null;
      if (sha256Hex(secret) !== outlet.password_hash) return null;
      return {
        staff_id: null,
        name: outlet.name,
        username: normalized,
        role: "manager" as const,
        is_admin: true, // outlet manager: full access within its own outlet
        outlet_id: outlet._id,
        is_hq: false,
        outlet_name: outlet.name,
      };
    }

    // 4. Staff login (username + 4-digit PIN) — bound to the staff's outlet.
    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!staff || !staff.is_active) return null;
    if (!staff.pin || staff.pin !== secret) return null;
    const staffOutlet = staff.outlet_id ? await ctx.db.get(staff.outlet_id) : null;
    return {
      staff_id: staff._id,
      name: staff.name,
      username: staff.username ?? normalized,
      role: staff.role,
      is_admin: false,
      outlet_id: staff.outlet_id ?? null,
      is_hq: false,
      outlet_name: staffOutlet?.name ?? null,
    };
  },
});

export const _insertSession = internalMutation({
  args: {
    token_hash: v.string(),
    staff_id: v.union(v.id("restaurant_staff"), v.null()),
    username: v.string(),
    is_admin: v.boolean(),
    outlet_id: v.union(v.id("outlets"), v.null()),
    is_hq: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("mobile_sessions", {
      staff_id: args.staff_id,
      username: args.username,
      is_admin: args.is_admin,
      outlet_id: args.outlet_id ?? undefined,
      is_hq: args.is_hq,
      token_hash: args.token_hash,
      created_at: now,
      last_used_at: now,
    });
  },
});

export const _revokeSessionByHash = internalMutation({
  args: { token_hash: v.string() },
  handler: async (ctx, { token_hash }) => {
    const session = await ctx.db
      .query("mobile_sessions")
      .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
      .first();
    if (!session) return;
    await ctx.db.patch(session._id, { revoked_at: Date.now() });
  },
});

export const _lookupSession = internalQuery({
  args: { token_hash: v.string() },
  handler: async (ctx, { token_hash }): Promise<Identity | null> => {
    const session = await ctx.db
      .query("mobile_sessions")
      .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
      .first();
    if (!session || session.revoked_at !== undefined) return null;

    if (session.is_hq === true) {
      return {
        staff_id: null,
        name: "Super Admin",
        username: session.username,
        role: "manager" as const,
        is_admin: true,
        outlet_id: null,
        is_hq: true,
        outlet_name: null,
      };
    }

    const outlet = session.outlet_id ? await ctx.db.get(session.outlet_id) : null;

    if (session.is_admin) {
      return {
        staff_id: null,
        name: outlet?.name ?? "Administrator",
        username: session.username,
        role: "manager" as const,
        is_admin: true,
        outlet_id: session.outlet_id ?? null,
        is_hq: false,
        outlet_name: outlet?.name ?? null,
      };
    }
    if (!session.staff_id) return null;
    const staff = await ctx.db.get(session.staff_id);
    if (!staff || !staff.is_active) return null;
    return {
      staff_id: staff._id,
      name: staff.name,
      username: staff.username ?? session.username,
      role: staff.role,
      is_admin: false,
      outlet_id: session.outlet_id ?? staff.outlet_id ?? null,
      is_hq: false,
      outlet_name: outlet?.name ?? null,
    };
  },
});

export const _touchSession = internalMutation({
  args: { token_hash: v.string() },
  handler: async (ctx, { token_hash }) => {
    const session = await ctx.db
      .query("mobile_sessions")
      .withIndex("by_token_hash", (q) => q.eq("token_hash", token_hash))
      .first();
    if (!session || session.revoked_at !== undefined) return;
    await ctx.db.patch(session._id, { last_used_at: Date.now() });
  },
});

// ─── Public actions used by the web SPA ───────────────────────────────────────

export const signIn = action({
  args: { username: v.string(), secret: v.string() },
  handler: async (
    ctx,
    { username, secret }
  ): Promise<{ token: string; identity: Identity } | null> => {
    // Same brute-force brake as the mobile login. A failed admin-password or
    // staff-PIN guess burns a token; honest users almost never spend more
    // than 1-2 tokens, so the throttle stays invisible.
    const throttleKey = username.trim().toLowerCase();
    const throttle = await ctx.runMutation(
      internal.mobileApi.consumeLoginAttempt,
      { username: throttleKey }
    );
    if (!throttle.allowed) {
      throw new Error(
        `Too many sign-in attempts. Try again in ${throttle.retry_after_seconds}s.`
      );
    }

    const identity: Identity | null = await ctx.runQuery(
      internal.auth._checkCredentials,
      { username, secret }
    );
    if (!identity) return null;
    const raw = generateRawToken();
    const token_hash = await hashToken(raw);
    await ctx.runMutation(internal.auth._insertSession, {
      token_hash,
      staff_id: identity.staff_id,
      username: identity.username,
      is_admin: identity.is_admin,
      outlet_id: identity.outlet_id,
      is_hq: identity.is_hq,
    });
    await ctx.runMutation(internal.mobileApi.clearLoginAttempts, {
      username: throttleKey,
    });
    return { token: raw, identity };
  },
});

export const validateSession = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Identity | null> => {
    if (!token) return null;
    const token_hash = await hashToken(token);
    const identity: Identity | null = await ctx.runQuery(
      internal.auth._lookupSession,
      { token_hash }
    );
    if (identity) {
      // Fire-and-forget touch — keeps last_used_at fresh without blocking.
      void ctx
        .runMutation(internal.auth._touchSession, { token_hash })
        .catch(() => undefined);
    }
    return identity;
  },
});

export const signOut = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token) return;
    const token_hash = await hashToken(token);
    await ctx.runMutation(internal.auth._revokeSessionByHash, { token_hash });
  },
});

// ─── Legacy entrypoints (kept so older clients fail closed, not crash) ────────
//
// The pre-token versions of these returned an identity object that the client
// stored in localStorage and trusted at face value. A user could write
// `{"is_admin": true}` directly into localStorage and the old `validateSession`
// would happily echo back an Administrator identity. Both are now no-ops that
// always return null — any client still calling them is forced to the login
// screen, where the new token flow takes over.

export const verifyCredentials = query({
  args: { username: v.string(), secret: v.string() },
  handler: async () => null,
});

// ─── Manager actions for setting / clearing employee logins ───────────────────

export const setStaffLogin = mutation({
  args: {
    id: v.id("restaurant_staff"),
    username: v.string(),
    pin: v.string(),
  },
  handler: async (ctx, { id, username, pin }) => {
    const normalized = username.trim().toLowerCase();
    if (normalized.length < 3) {
      throw new Error("Username must be at least 3 characters");
    }
    if (!/^[a-z0-9._-]+$/.test(normalized)) {
      throw new Error("Username may only contain letters, numbers, '.', '_' or '-'");
    }
    if (!/^\d{4}$/.test(pin)) {
      throw new Error("PIN must be exactly 4 digits");
    }
    const dupe = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .first();
    if (dupe && dupe._id !== id) {
      throw new Error("Another staff member already uses this username");
    }
    await ctx.db.patch(id, { username: normalized, pin });
  },
});

export const clearStaffLogin = mutation({
  args: { id: v.id("restaurant_staff") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { username: undefined, pin: undefined });
  },
});
