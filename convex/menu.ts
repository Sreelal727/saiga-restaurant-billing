import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

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
    category_id: v.optional(v.id("menu_categories")),
    active_only: v.optional(v.boolean()),
  },
  handler: async (ctx, { category_id, active_only }) => {
    let items = category_id
      ? await ctx.db
          .query("menu_items")
          .withIndex("by_category", (q) => q.eq("category_id", category_id))
          .collect()
      : await ctx.db.query("menu_items").collect();

    if (active_only) {
      items = items.filter((i) => i.is_active);
    }

    return Promise.all(items.map((i) => withImageUrl(ctx, i)));
  },
});

export const listWithCategories = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .filter((q) => q.eq(q.field("is_active"), true))
      .collect();

    const items = await ctx.db
      .query("menu_items")
      .withIndex("by_active", (q) => q.eq("is_active", true))
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
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("menu_categories")
      .withIndex("by_display_order")
      .collect();

    const items = await ctx.db.query("menu_items").collect();
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
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// ─── Item mutations ───────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    category_id: v.id("menu_categories"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    is_veg: v.boolean(),
    has_inventory: v.boolean(),
    image_storage_id: v.optional(v.id("_storage")),
    image_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("menu_items", {
      ...args,
      is_active: true,
    });

    if (args.has_inventory) {
      await ctx.db.insert("inventory_stock", {
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
    id: v.id("menu_items"),
    category_id: v.optional(v.id("menu_categories")),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    is_veg: v.optional(v.boolean()),
    is_active: v.optional(v.boolean()),
    has_inventory: v.optional(v.boolean()),
    image_url: v.optional(v.string()),
    image_storage_id: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { id, ...fields }) => {
    // If the image is being replaced, delete the previous storage object
    // so we don't leak files. Passing image_storage_id explicitly (even null
    // is not supported by Convex validators, so use removeImage below).
    if (fields.image_storage_id !== undefined) {
      const current = await ctx.db.get(id);
      if (current?.image_storage_id && current.image_storage_id !== fields.image_storage_id) {
        await ctx.storage.delete(current.image_storage_id);
      }
    }
    await ctx.db.patch(id, fields);
  },
});

/**
 * Remove the image from an item (clear both legacy URL and storage ref,
 * and delete the storage file if any). Useful because validator-style
 * patches can't set fields to undefined directly.
 */
export const removeImage = mutation({
  args: { id: v.id("menu_items") },
  handler: async (ctx, { id }) => {
    const current = await ctx.db.get(id);
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
  args: { id: v.id("menu_items") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
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
  args: { id: v.id("menu_items") },
  handler: async (ctx, { id }) => {
    await removeOne(ctx, id);
  },
});

// ─── Bulk mutations ───────────────────────────────────────────────────────────

export const bulkRemove = mutation({
  args: { ids: v.array(v.id("menu_items")) },
  handler: async (ctx, { ids }) => {
    if (ids.length === 0) return { deleted: 0, deactivated: 0 };
    let deleted = 0;
    let deactivated = 0;
    for (const id of ids) {
      const item = await ctx.db.get(id);
      if (!item) continue;
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
    ids: v.array(v.id("menu_items")),
    is_active: v.boolean(),
  },
  handler: async (ctx, { ids, is_active }) => {
    for (const id of ids) {
      await ctx.db.patch(id, { is_active });
    }
    return { count: ids.length };
  },
});
