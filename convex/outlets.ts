import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireHq } from "./lib/tenant";

/**
 * List all outlets — HQ/super-admin only. Powers the outlet switcher and the
 * consolidated views. Default outlet (JABAL MANDI) sorts first.
 */
export const listForHq = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireHq(ctx, token);
    const outlets = await ctx.db.query("outlets").collect();
    return outlets
      .filter((o) => o.is_active)
      .sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((o) => ({ _id: o._id, name: o.name, slug: o.slug, is_default: o.is_default ?? false }));
  },
});
