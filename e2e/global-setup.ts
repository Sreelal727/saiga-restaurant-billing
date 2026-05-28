import { ConvexHttpClient } from "convex/browser";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api";

/**
 * Seed the Convex deployment before the E2E suite. Tests assume:
 *   - a clean menu/tables/staff dataset (matches `seed.run`)
 *   - all tables start as `available`
 *   - no in-flight orders
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` from `.env.local` so we hit the same
 * deployment the running Next.js dev server is using.
 */
export default async function globalSetup(): Promise<void> {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "[e2e] NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` once " +
        "to provision a deployment and populate `.env.local`, then re-run."
    );
  }

  const client = new ConvexHttpClient(url);
  await client.mutation(api.seed.run, {});
  // eslint-disable-next-line no-console
  console.log(`[e2e] Seeded Convex deployment at ${url}`);
}
