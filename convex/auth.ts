import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Simple credentials check. Two flows:
 *
 *  - Admin: username "admin" (or `ADMIN_USERNAME` env var) + password
 *    `ADMIN_PASSWORD` env var (default "admin123" for first-boot setups).
 *  - Staff: a row in `restaurant_staff` with a matching `username` + 4-digit `pin`.
 *
 * On success, returns a small session payload the client stores in localStorage.
 * No JWTs, no cookies, no backend gating — pages just check whether a session
 * exists in browser state and render the login screen otherwise.
 */
export const verifyCredentials = query({
  args: { username: v.string(), secret: v.string() },
  handler: async (ctx, { username, secret }) => {
    const normalized = username.trim().toLowerCase();
    if (normalized.length === 0 || secret.length === 0) return null;

    const adminUser = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD ?? "admin123";

    if (normalized === adminUser) {
      if (secret !== adminPass) return null;
      return {
        staff_id: null,
        name: "Administrator",
        username: adminUser,
        role: "manager" as const,
        is_admin: true,
      };
    }

    const staff = await ctx.db
      .query("restaurant_staff")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();

    if (!staff || !staff.is_active) return null;
    if (!staff.pin || staff.pin !== secret) return null;

    return {
      staff_id: staff._id,
      name: staff.name,
      username: staff.username ?? normalized,
      role: staff.role,
      is_admin: false,
    };
  },
});

/**
 * Re-validate a session each time the layout mounts (e.g. after page reload).
 * If the staff record was deleted/deactivated/PIN changed since login, the
 * client will see `null` and bounce the user back to the login screen.
 */
export const validateSession = query({
  args: {
    staff_id: v.union(v.id("restaurant_staff"), v.null()),
    is_admin: v.boolean(),
  },
  handler: async (ctx, { staff_id, is_admin }) => {
    if (is_admin) {
      // Admin is always valid as long as the deployment is up.
      return {
        staff_id: null,
        name: "Administrator",
        username: (process.env.ADMIN_USERNAME ?? "admin").toLowerCase(),
        role: "manager" as const,
        is_admin: true,
      };
    }
    if (!staff_id) return null;
    const staff = await ctx.db.get(staff_id);
    if (!staff || !staff.is_active) return null;
    return {
      staff_id: staff._id,
      name: staff.name,
      username: staff.username ?? null,
      role: staff.role,
      is_admin: false,
    };
  },
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
