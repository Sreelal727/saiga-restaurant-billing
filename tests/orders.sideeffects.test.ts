import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

describe("orders.create — inventory side effects", () => {
  test("deducts stock for tracked items", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 10 });

    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.trackedItemId, quantity: 3 }],
      ...ZERO_CHARGES,
    });

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(7);
  });

  test("does nothing to stock for untracked items", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 10 });

    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 5 }],
      ...ZERO_CHARGES,
    });

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(10);
  });

  test("throws on insufficient stock and surfaces an actionable message", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 2 });

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.trackedItemId, quantity: 5 }],
        ...ZERO_CHARGES,
      })
    ).rejects.toThrow(/insufficient stock.*paneer tikka/i);
  });
});

describe("orders.create — table side effects", () => {
  test("dine-in marks table occupied with current_order_id pointing at the new order", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "dine_in",
      table_id: ids.tableId,
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("occupied");
    expect(table?.current_order_id).toBe(orderId);
  });

  test("takeaway order does not touch table state", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
    expect(table?.current_order_id).toBeUndefined();
  });
});
