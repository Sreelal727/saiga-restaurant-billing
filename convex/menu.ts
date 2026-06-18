import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireOutlet, assertSameOutlet } from "./lib/tenant";

// ─── URL resolution helper ────────────────────────────────────────────────────

type ItemWithImage = Omit<Doc<"menu_items">, "image_url"> & {
  image_url: string | null;
};

/**
 * Resolve the displayable image URL for a menu_item:
 *   - If image_storage_id is set, return the signed URL from Convex storage.
 *   - Else fall back to the legacy image_url string field.
 *   - Else null.
 *
 * Returns a new shape with `image_url: string | null` (the underlying field is
 * `string | undefined`); clients can treat both null and missing as "no image".
 */
async function withImageUrl(
  ctx: QueryCtx,
  item: Doc<"menu_items">
): Promise<ItemWithImage> {
  let url: string | null = item.image_url ?? null;
  if (item.image_storage_id) {
    url = await ctx.storage.getUrl(item.image_storage_id);
  }
  return { ...item, image_url: url };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    category_id: v.optional(v.id("menu_categories")),
    active_only: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, outletId, category_id, active_only }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    let items = await ctx.db
      .query("menu_items")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();

    if (category_id) {
      items = items.filter((i) => i.category_id === category_id);
    }
    if (active_only) {
      items = items.filter((i) => i.is_active);
    }

    return Promise.all(items.map((i) => withImageUrl(ctx, i)));
  },
});

export const listWithCategories = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const categories = (
      await ctx.db
        .query("menu_categories")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    )
      .filter((c) => c.is_active)
      .sort((a, b) => a.display_order - b.display_order);

    const items = await ctx.db
      .query("menu_items")
      .withIndex("by_outlet_active", (q) =>
        q.eq("outlet_id", oid).eq("is_active", true)
      )
      .collect();
    const enriched = await Promise.all(items.map((i) => withImageUrl(ctx, i)));

    return categories.map((cat) => ({
      ...cat,
      items: enriched.filter((i) => i.category_id === cat._id),
    }));
  },
});

/**
 * Admin view: all categories + all items, regardless of `is_active`.
 */
export const listAdmin = query({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    const categories = (
      await ctx.db
        .query("menu_categories")
        .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
        .collect()
    ).sort((a, b) => a.display_order - b.display_order);

    const items = await ctx.db
      .query("menu_items")
      .withIndex("by_outlet", (q) => q.eq("outlet_id", oid))
      .collect();
    const enriched = await Promise.all(items.map((i) => withImageUrl(ctx, i)));

    return categories.map((cat) => ({
      ...cat,
      items: enriched.filter((i) => i.category_id === cat._id),
    }));
  },
});

// ─── Image upload ─────────────────────────────────────────────────────────────

/**
 * Returns a short-lived signed URL the browser POSTs the file to.
 * Response from that POST contains a storageId the client passes back to
 * `update` or `create` as `image_storage_id`.
 */
export const generateUploadUrl = mutation({
  args: { token: v.string(), outletId: v.id("outlets") },
  handler: async (ctx, { token, outletId }) => {
    // Auth only — no data is scoped here, but the caller must hold a valid
    // outlet session before we hand out a signed upload URL.
    await requireOutlet(ctx, token, outletId);
    return await ctx.storage.generateUploadUrl();
  },
});

// ─── Portion / size variants ────────────────────────────────────────────────

const variantValidator = v.array(
  v.object({
    label: v.string(),
    price: v.number(),
    unit_factor: v.optional(v.number()),
  })
);

type VariantInput = { label: string; price: number; unit_factor?: number };

/**
 * Trim + validate portion rows. Throws on bad input. Returns the cleaned list,
 * or undefined when there are no portions (item is single-price).
 */
function normalizeVariants(variants: VariantInput[] | undefined): VariantInput[] | undefined {
  if (!variants || variants.length === 0) return undefined;
  const cleaned = variants.map((variant) => ({
    label: variant.label.trim(),
    price: variant.price,
    unit_factor: variant.unit_factor ?? 1,
  }));
  if (cleaned.some((c) => !c.label)) {
    throw new Error("Each portion needs a label");
  }
  if (cleaned.some((c) => !Number.isFinite(c.price) || c.price < 0)) {
    throw new Error("Portion price cannot be negative");
  }
  if (cleaned.some((c) => !Number.isFinite(c.unit_factor) || c.unit_factor <= 0)) {
    throw new Error("Stock factor must be greater than 0");
  }
  const labels = new Set(cleaned.map((c) => c.label.toLowerCase()));
  if (labels.size !== cleaned.length) {
    throw new Error("Portion labels must be unique");
  }
  return cleaned;
}

// ─── Item mutations ───────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    category_id: v.id("menu_categories"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    variants: v.optional(variantValidator),
    open_price: v.optional(v.boolean()),
    is_veg: v.boolean(),
    has_inventory: v.boolean(),
    image_storage_id: v.optional(v.id("_storage")),
    image_url: v.optional(v.string()),
  },
  handler: async (ctx, { token, outletId, ...args }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);

    // Open-price ("as per size") items have no fixed price and no portions.
    const openPrice = args.open_price === true;
    const variants = openPrice ? undefined : normalizeVariants(args.variants);
    const price = openPrice ? 0 : variants ? Math.min(...variants.map((v) => v.price)) : args.price;

    const id = await ctx.db.insert("menu_items", {
      outlet_id: oid,
      category_id: args.category_id,
      name: args.name,
      description: args.description,
      price,
      variants,
      open_price: openPrice ? true : undefined,
      is_veg: args.is_veg,
      has_inventory: args.has_inventory,
      image_storage_id: args.image_storage_id,
      image_url: args.image_url,
      is_active: true,
    });

    if (args.has_inventory) {
      await ctx.db.insert("inventory_stock", {
        outlet_id: oid,
        menu_item_id: id,
        quantity: 0,
        unit: "pcs",
        low_stock_threshold: 10,
      });
    }

    return id;
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    id: v.id("menu_items"),
    category_id: v.optional(v.id("menu_categories")),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    // Pass a non-empty array to set portions, or an empty array to clear them
    // (revert the item to single-price). Omit to leave portions unchanged.
    variants: v.optional(variantValidator),
    open_price: v.optional(v.boolean()),
    is_veg: v.optional(v.boolean()),
    is_active: v.optional(v.boolean()),
    has_inventory: v.optional(v.boolean()),
    image_url: v.optional(v.string()),
    image_storage_id: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { token, outletId, id, variants, price, open_price, ...fields }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);

    // If the image is being replaced, delete the previous storage object
    // so we don't leak files. Passing image_storage_id explicitly (even null
    // is not supported by Convex validators, so use removeImage below).
    if (fields.image_storage_id !== undefined) {
      const current = await ctx.db.get(id);
      if (current?.image_storage_id && current.image_storage_id !== fields.image_storage_id) {
        await ctx.storage.delete(current.image_storage_id);
      }
    }

    const patch: Record<string, unknown> = { ...fields };

    if (open_price !== undefined) {
      patch.open_price = open_price ? true : undefined;
    }

    if (open_price === true) {
      // "As per size" — no fixed price, no portions.
      patch.variants = undefined;
      patch.price = 0;
    } else if (variants !== undefined) {
      const normalized = normalizeVariants(variants);
      if (normalized) {
        // Portions set — base price mirrors the cheapest portion.
        patch.variants = normalized;
        patch.price = Math.min(...normalized.map((v) => v.price));
      } else {
        // Empty array → clear portions, fall back to the single price.
        patch.variants = undefined;
        if (price !== undefined) patch.price = price;
      }
    } else if (price !== undefined) {
      patch.price = price;
    }

    await ctx.db.patch(id, patch);
  },
});

/**
 * Remove the image from an item (clear both legacy URL and storage ref,
 * and delete the storage file if any). Useful because validator-style
 * patches can't set fields to undefined directly.
 */
export const removeImage = mutation({
  args: { token: v.string(), outletId: v.id("outlets"), id: v.id("menu_items") },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const current = await ctx.db.get(id);
    assertSameOutlet(current, oid);
    if (!current) throw new Error("Item not found");
    if (current.image_storage_id) {
      await ctx.storage.delete(current.image_storage_id);
    }
    await ctx.db.patch(id, {
      image_storage_id: undefined,
      image_url: undefined,
    });
  },
});

export const toggleActive = mutation({
  args: { token: v.string(), outletId: v.id("outlets"), id: v.id("menu_items") },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    const item = await ctx.db.get(id);
    assertSameOutlet(item, oid);
    if (!item) throw new Error("Item not found");
    await ctx.db.patch(id, { is_active: !item.is_active });
  },
});

/**
 * Soft-delete (set is_active=false) if any order_items still reference the
 * menu item, otherwise hard-delete plus clean up linked inventory + image.
 */
async function removeOne(ctx: MutationCtx, id: Id<"menu_items">): Promise<void> {
  const activeOrderItem = await ctx.db
    .query("order_items")
    .withIndex("by_menu_item", (q) => q.eq("menu_item_id", id))
    .first();

  if (activeOrderItem) {
    await ctx.db.patch(id, { is_active: false });
    return;
  }

  const item = await ctx.db.get(id);
  if (!item) return; // already gone

  if (item.image_storage_id) {
    await ctx.storage.delete(item.image_storage_id);
  }

  const stock = await ctx.db
    .query("inventory_stock")
    .withIndex("by_menu_item", (q) => q.eq("menu_item_id", id))
    .first();
  if (stock) await ctx.db.delete(stock._id);

  await ctx.db.delete(id);
}

export const remove = mutation({
  args: { token: v.string(), outletId: v.id("outlets"), id: v.id("menu_items") },
  handler: async (ctx, { token, outletId, id }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    assertSameOutlet(await ctx.db.get(id), oid);
    await removeOne(ctx, id);
  },
});

// ─── Bulk mutations ───────────────────────────────────────────────────────────

export const bulkRemove = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    ids: v.array(v.id("menu_items")),
  },
  handler: async (ctx, { token, outletId, ids }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    if (ids.length === 0) return { deleted: 0, deactivated: 0 };
    let deleted = 0;
    let deactivated = 0;
    for (const id of ids) {
      const item = await ctx.db.get(id);
      if (!item) continue;
      assertSameOutlet(item, oid);
      const activeOrderItem = await ctx.db
        .query("order_items")
        .withIndex("by_menu_item", (q) => q.eq("menu_item_id", id))
        .first();
      if (activeOrderItem) {
        await ctx.db.patch(id, { is_active: false });
        deactivated += 1;
      } else {
        if (item.image_storage_id) {
          await ctx.storage.delete(item.image_storage_id);
        }
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_menu_item", (q) => q.eq("menu_item_id", id))
          .first();
        if (stock) await ctx.db.delete(stock._id);
        await ctx.db.delete(id);
        deleted += 1;
      }
    }
    return { deleted, deactivated };
  },
});

export const bulkSetActive = mutation({
  args: {
    token: v.string(),
    outletId: v.id("outlets"),
    ids: v.array(v.id("menu_items")),
    is_active: v.boolean(),
  },
  handler: async (ctx, { token, outletId, ids, is_active }) => {
    const { outletId: oid } = await requireOutlet(ctx, token, outletId);
    for (const id of ids) {
      assertSameOutlet(await ctx.db.get(id), oid);
      await ctx.db.patch(id, { is_active });
    }
    return { count: ids.length };
  },
});
