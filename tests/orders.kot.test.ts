import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

async function createOrderWithItems() {
  const t = makeTest();
  const ids = await seed(t);
  const orderId = await t.mutation(api.orders.create, {
    order_type: "dine_in",
    table_id: ids.tableId,
    items: [
      { menu_item_id: ids.trackedItemId, quantity: 1 },
      { menu_item_id: ids.untrackedItemId, quantity: 2 },
    ],
    ...ZERO_CHARGES,
  });
  return { t, ids, orderId };
}

describe("orders.markKotPrinted", () => {
  test("stamps all initial items with batch 1 and bumps kot_count", async () => {
    const { t, orderId } = await createOrderWithItems();

    const result = await t.mutation(api.orders.markKotPrinted, { id: orderId });
    expect(result.batch_number).toBe(1);
    expect(result.items).toHaveLength(2);

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.kot_count).toBe(1);

    const items = await t.run((ctx) =>
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    expect(items.every((i) => i.kot_batch === 1)).toBe(true);
  });

  test("subsequent call is a no-op when nothing new has been added", async () => {
    const { t, orderId } = await createOrderWithItems();
    await t.mutation(api.orders.markKotPrinted, { id: orderId });

    const result = await t.mutation(api.orders.markKotPrinted, { id: orderId });
    expect(result.batch_number).toBeNull();
    expect(result.items).toHaveLength(0);

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.kot_count).toBe(1);
  });

  test("addItems after a KOT creates a second batch that only includes the new items", async () => {
    const { t, ids, orderId } = await createOrderWithItems();
    await t.mutation(api.orders.markKotPrinted, { id: orderId });

    await t.mutation(api.orders.addItems, {
      id: orderId,
      items: [{ menu_item_id: ids.trackedItemId, quantity: 1 }],
    });

    const result = await t.mutation(api.orders.markKotPrinted, { id: orderId });
    expect(result.batch_number).toBe(2);
    expect(result.items).toHaveLength(1);

    const items = await t.run((ctx) =>
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    const batches = items.map((i) => i.kot_batch).sort();
    expect(batches).toEqual([1, 1, 2]);

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.kot_count).toBe(2);
  });

  test("rejects KOT printing on a cancelled order", async () => {
    const { t, orderId } = await createOrderWithItems();
    await t.mutation(api.orders.updateStatus, {
      id: orderId,
      status: "cancelled",
    });
    await expect(
      t.mutation(api.orders.markKotPrinted, { id: orderId })
    ).rejects.toThrow(/cancelled/i);
  });
});
