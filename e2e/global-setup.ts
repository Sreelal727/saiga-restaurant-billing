import { ConvexHttpClient } from "convex/browser";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api";

/**
 * Seed the Convex deployment before the E2E suite. Tests assume:
 *   - a clean menu/tables/staff dataset (matches `seedE2E.run`)
 *   - all tables start as `available`
 *   - no in-flight orders
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` from `.env.local` so we hit the same
 * deployment the running Next.js dev server is using. The seedE2E mutation
 * itself is gated by SEED_ENABLED=yes — set that on the dev deployment
 * (never on prod) for tests to populate fixtures.
 */
function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export default async function globalSetup(): Promise<void> {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "[e2e] NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` once " +
        "to provision a deployment and populate `.env.local`, then re-run."
    );
  }

  const client = new ConvexHttpClient(url);
  await client.mutation(api.seedE2E.run, {});
  // eslint-disable-next-line no-console
  console.log(`[e2e] Seeded Convex deployment at ${url}`);
}
