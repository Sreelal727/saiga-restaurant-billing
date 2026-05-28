import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeAuthedTest } from "./setup";

describe("menu.bulkRemove", () => {
  test("hard-deletes items with no order references", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    const result = await t.mutation(api.menu.bulkRemove, {
      ids: [ids.untrackedItemId, ids.inactiveItemId],
    });

    expect(result).toEqual({ deleted: 2, deactivated: 0 });
    const [u, i] = await t.run((ctx) =>
      Promise.all([
        ctx.db.get(ids.untrackedItemId),
        ctx.db.get(ids.inactiveItemId),
      ])
    );
    expect(u).toBeNull();
    expect(i).toBeNull();
  });

  test("soft-deletes items still referenced by an order", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    // Create an order referencing the tracked item — it now has an order_item row
    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.trackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const result = await t.mutation(api.menu.bulkRemove, {
      ids: [ids.trackedItemId, ids.untrackedItemId],
    });

    expect(result).toEqual({ deleted: 1, deactivated: 1 });

    const tracked = await t.run((ctx) => ctx.db.get(ids.trackedItemId));
    expect(tracked).not.toBeNull();
    expect(tracked?.is_active).toBe(false);

    const untracked = await t.run((ctx) => ctx.db.get(ids.untrackedItemId));
    expect(untracked).toBeNull();
  });

  test("removes the linked inventory_stock row when an item is hard-deleted", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    await t.mutation(api.menu.bulkRemove, { ids: [ids.trackedItemId] });

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock).toBeNull();
  });

  test("is a no-op on an empty list", async () => {
    const { t } = await makeAuthedTest();
    await seed(t);
    const result = await t.mutation(api.menu.bulkRemove, { ids: [] });
    expect(result).toEqual({ deleted: 0, deactivated: 0 });
  });
});

describe("menu.bulkSetActive", () => {
  test("deactivates many items in one call", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    const result = await t.mutation(api.menu.bulkSetActive, {
      ids: [ids.trackedItemId, ids.untrackedItemId],
      is_active: false,
    });

    expect(result).toEqual({ count: 2 });
    const [a, b] = await t.run((ctx) =>
      Promise.all([
        ctx.db.get(ids.trackedItemId),
        ctx.db.get(ids.untrackedItemId),
      ])
    );
    expect(a?.is_active).toBe(false);
    expect(b?.is_active).toBe(false);
  });

  test("reactivates previously inactive items", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    await t.mutation(api.menu.bulkSetActive, {
      ids: [ids.inactiveItemId],
      is_active: true,
    });

    const inactive = await t.run((ctx) => ctx.db.get(ids.inactiveItemId));
    expect(inactive?.is_active).toBe(true);
  });
});

describe("menu.update — image_storage_id replacement", () => {
  test("clearing image via removeImage wipes both fields", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);

    // Plant a legacy image_url string on the tracked item
    await t.run((ctx) =>
      ctx.db.patch(ids.trackedItemId, { image_url: "https://example.com/legacy.jpg" })
    );

    await t.mutation(api.menu.removeImage, { id: ids.trackedItemId });

    const item = await t.run((ctx) => ctx.db.get(ids.trackedItemId));
    expect(item?.image_url).toBeUndefined();
    expect(item?.image_storage_id).toBeUndefined();
  });
});
