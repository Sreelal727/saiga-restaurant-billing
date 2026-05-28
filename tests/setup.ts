import { convexTest } from "convex-test";
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
 * Legacy export: in earlier sessions, mutations were gated by Convex Auth
 * and tests needed a fake identity. After ripping Convex Auth out, all
 * gated mutations are now open — this helper still exists so older tests
 * that destructure `{ t }` from it keep working.
 */
export async function makeAuthedTest(
  _role: "manager" | "cashier" | "waiter" = "manager"
) {
  return { t: makeTest() };
}
