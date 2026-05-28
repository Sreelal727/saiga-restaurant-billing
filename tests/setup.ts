import { convexTest, type TestConvex } from "convex-test";
import schema from "../convex/schema";

// Convex function modules + the generated runtime. Vite's `import.meta.glob`
// skips underscore-prefixed dirs by default, so `_generated/*.js` is added
// explicitly. Declaration files are excluded so convex-test only sees real
// function modules.
const modules = import.meta.glob([
  "../convex/**/*.ts",
  "../convex/_generated/*.js",
  "!../convex/**/*.d.ts",
]);

export function makeTest() {
  return convexTest(schema, modules);
}

/**
 * Returns a test instance that's already "signed in" as a freshly seeded
 * manager. Use this for any flow whose mutations are gated by
 * `requireManager` / `requireAuth`.
 *
 * Internally we insert rows directly into Convex Auth's `users` and
 * `authSessions` tables and then call `withIdentity` with the same subject
 * shape that `getAuthUserId` parses — `userId|sessionId`.
 */
export async function makeAuthedTest(role: "manager" | "cashier" | "waiter" = "manager") {
  const t = convexTest(schema, modules);

  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: `test-${role}@local`,
      name: `test-${role}`,
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 24 * 60 * 60_000,
    });
    await ctx.db.insert("restaurant_staff", {
      name: `Test ${role}`,
      role,
      is_active: true,
      user_id: userId,
    });
    return { userId, sessionId };
  });

  // `withIdentity` returns a narrower type that lacks `withIdentity` /
  // `registerComponent`. The runtime object still has them, so we cast back
  // to the full TestConvex<typeof schema> so helpers like `seed()` accept it.
  const authed = t.withIdentity({
    subject: `${userId}|${sessionId}`,
  }) as TestConvex<typeof schema>;
  return { t: authed, userId, sessionId };
}
