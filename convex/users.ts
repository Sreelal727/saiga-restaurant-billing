import {
  query,
  mutation,
  action,
  QueryCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { getAuthUserId, createAccount } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * The currently signed-in user + their linked staff record (if any).
 * Returns `null` if no session.
 */
export const currentStaff = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .unique();
    return {
      user_id: userId,
      username: user.name ?? user.email ?? "user",
      staff,
      role: staff?.role ?? null,
    };
  },
});

// ─── Auth helpers (used by other modules) ─────────────────────────────────────

/**
 * Throws if the caller isn't signed in. Returns the user id.
 */
export async function requireAuth(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authentication required");
  return userId;
}

/**
 * Throws if the caller isn't a manager. Returns the staff record.
 */
export async function requireManager(ctx: QueryCtx) {
  const userId = await requireAuth(ctx);
  const staff = await ctx.db
    .query("restaurant_staff")
    .withIndex("by_user", (q) => q.eq("user_id", userId))
    .unique();
  if (!staff || staff.role !== "manager") {
    throw new Error("Manager role required");
  }
  return staff;
}

// ─── Manager-only mutation: create a staff login ──────────────────────────────

/**
 * Convenience query for the staff page: list users that aren't yet linked to
 * a staff record (so a manager can pick one to link). For now returns nothing
 * special because new users are created on-the-fly when a staff member's
 * login is provisioned via the create-user flow.
 */
export const listOrphanUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    // Only managers need this view
    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .unique();
    if (!staff || staff.role !== "manager") return [];

    const allUsers = await ctx.db.query("users").collect();
    const allStaff = await ctx.db.query("restaurant_staff").collect();
    const linked = new Set(allStaff.map((s) => s.user_id).filter(Boolean));
    return allUsers.filter((u) => !linked.has(u._id));
  },
});

/**
 * Unlink a staff member's login (without deleting their record). Use when
 * an employee leaves but historical orders should remain attributed to them.
 */
export const unlinkStaffUser = mutation({
  args: { staff_id: v.id("restaurant_staff") },
  handler: async (ctx, { staff_id }) => {
    await requireManager(ctx);
    const staff = await ctx.db.get(staff_id);
    if (!staff) throw new Error("Staff not found");
    if (!staff.user_id) return;
    // Best-effort: delete the user; their auth sessions get invalidated.
    await ctx.db.delete(staff.user_id);
    await ctx.db.patch(staff_id, { user_id: undefined });
  },
});

// ─── Bootstrap admin (one-shot action) ────────────────────────────────────────

/**
 * Idempotent admin bootstrap. Creates an "admin" user if none exists, plus
 * an "Admin" staff record linked to it. Designed to be invoked once after
 * `seed.run` via:
 *
 *     npx convex run users:ensureAdminUser
 *
 * The default password is `admin123` — set the `ADMIN_DEFAULT_PASSWORD`
 * Convex env var (`npx convex env set ADMIN_DEFAULT_PASSWORD ...`) to
 * override before running.
 */
export const ensureAdminUser = action({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.runQuery(internal.users._findAdmin, {});
    if (existing.userExists && existing.staffLinked) {
      return {
        created: false,
        message:
          "Admin user already exists and is linked. " +
          "Use the username 'admin' to sign in.",
      };
    }

    const password = process.env.ADMIN_DEFAULT_PASSWORD ?? "admin123";

    let userId = existing.adminUserId;
    if (!userId) {
      const { user } = await createAccount(ctx, {
        provider: "password",
        account: { id: "admin@local", secret: password },
        profile: { email: "admin@local", name: "admin" },
      });
      userId = user._id as Id<"users">;
    }

    await ctx.runMutation(internal.users._ensureAdminStaff, {
      user_id: userId,
    });

    return {
      created: true,
      username: "admin",
      password,
      message:
        "Admin user is ready. Sign in with username 'admin' and the " +
        "configured password. Change it from the Staff page after signing in.",
    };
  },
});

export const _findAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), "admin@local"))
      .first();
    if (!admin) return { userExists: false, staffLinked: false };
    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_user", (q) => q.eq("user_id", admin._id))
      .first();
    return {
      userExists: true,
      staffLinked: staff !== null && staff !== undefined,
      adminUserId: admin._id,
    };
  },
});

export const _ensureAdminStaff = internalMutation({
  args: { user_id: v.id("users") },
  handler: async (ctx, { user_id }) => {
    // Already linked? No-op.
    const linked = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_user", (q) => q.eq("user_id", user_id))
      .first();
    if (linked) return;

    // Pick an existing manager record that isn't linked yet, or create one.
    const unlinkedManager = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_role", (q) => q.eq("role", "manager"))
      .filter((q) => q.eq(q.field("user_id"), undefined))
      .first();

    if (unlinkedManager) {
      await ctx.db.patch(unlinkedManager._id, { user_id });
      return;
    }

    await ctx.db.insert("restaurant_staff", {
      name: "Admin",
      role: "manager",
      is_active: true,
      user_id,
    });
  },
});

// ─── Manager-only: create a login for an existing staff member ────────────────

/**
 * Server-side mutation invoked by the staff page after a manager has chosen
 * a staff row and a username/password. This mutation only verifies the
 * caller's role and prepares the link — actual account creation must happen
 * via the action below (bcrypt requires Node).
 */
export const _linkStaffToUser = internalMutation({
  args: {
    staff_id: v.id("restaurant_staff"),
    user_id: v.id("users"),
  },
  handler: async (ctx, { staff_id, user_id }) => {
    const staff = await ctx.db.get(staff_id);
    if (!staff) throw new Error("Staff not found");
    if (staff.user_id) {
      throw new Error("Staff member already has a login");
    }
    await ctx.db.patch(staff_id, { user_id });
  },
});

export const createStaffLogin = action({
  args: {
    staff_id: v.id("restaurant_staff"),
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, { staff_id, username, password }) => {
    // Permission check via an internal query — actions can't read auth
    // directly, so we forward to a query that knows the caller's identity.
    const callerRole = await ctx.runQuery(internal.users._callerRole, {});
    if (callerRole !== "manager") {
      throw new Error("Only managers can create staff logins");
    }
    const normalized = username.trim().toLowerCase();
    if (normalized.length < 3) {
      throw new Error("Username must be at least 3 characters");
    }
    if (!/^[a-z0-9._-]+$/.test(normalized)) {
      throw new Error(
        "Username may only contain letters, numbers, '.', '_' or '-'"
      );
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: `${normalized}@local`, secret: password },
      profile: { email: `${normalized}@local`, name: normalized },
    });

    await ctx.runMutation(internal.users._linkStaffToUser, {
      staff_id,
      user_id: user._id as Id<"users">,
    });

    return { user_id: user._id, username: normalized };
  },
});

export const _callerRole = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_user", (q) => q.eq("user_id", userId))
      .unique();
    return staff?.role ?? null;
  },
});
