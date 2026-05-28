import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed } from "./fixtures";
import { makeTest } from "./setup";

describe("inventory.dump", () => {
  test("deducts the dumped quantity from the stock row and writes a dump log", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 10 });

    const dumpId = await t.mutation(api.inventory.dump, {
      id: ids.trackedStockId,
      quantity: 3,
      reason: "end of day waste",
    });

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(7);

    const dumpRow = await t.run((ctx) => ctx.db.get(dumpId));
    expect(dumpRow?.quantity).toBe(3);
    expect(dumpRow?.reason).toBe("end of day waste");
    expect(dumpRow?.menu_item_id).toBe(ids.trackedItemId);
    expect(dumpRow?.dumped_at).toBeGreaterThan(0);
  });

  test("rejects a dump larger than current stock", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 2 });

    await expect(
      t.mutation(api.inventory.dump, {
        id: ids.trackedStockId,
        quantity: 5,
      })
    ).rejects.toThrow(/only 2 in stock/i);

    // Stock untouched
    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(2);
  });

  test("rejects a non-positive or non-integer dump", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.inventory.dump, { id: ids.trackedStockId, quantity: 0 })
    ).rejects.toThrow(/positive integer/i);
    await expect(
      t.mutation(api.inventory.dump, { id: ids.trackedStockId, quantity: 1.5 })
    ).rejects.toThrow(/positive integer/i);
    await expect(
      t.mutation(api.inventory.dump, { id: ids.trackedStockId, quantity: -1 })
    ).rejects.toThrow(/positive integer/i);
  });
});

describe("inventory.removeDump", () => {
  test("delete-only mode discards the log entry without touching stock", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 10 });
    const dumpId = await t.mutation(api.inventory.dump, {
      id: ids.trackedStockId,
      quantity: 4,
    });

    await t.mutation(api.inventory.removeDump, { id: dumpId });

    const dumpRow = await t.run((ctx) => ctx.db.get(dumpId));
    expect(dumpRow).toBeNull();

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(6); // unchanged from after the dump
  });

  test("restore=true returns the dumped quantity to stock", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 10 });
    const dumpId = await t.mutation(api.inventory.dump, {
      id: ids.trackedStockId,
      quantity: 4,
    });

    await t.mutation(api.inventory.removeDump, { id: dumpId, restore: true });

    const stock = await t.run((ctx) => ctx.db.get(ids.trackedStockId));
    expect(stock?.quantity).toBe(10);
  });
});

describe("inventory.dumpsRecent", () => {
  test("returns today's dumps newest-first with the menu item enriched", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 20 });

    await t.mutation(api.inventory.dump, {
      id: ids.trackedStockId,
      quantity: 2,
    });
    await t.mutation(api.inventory.dump, {
      id: ids.trackedStockId,
      quantity: 3,
      reason: "leftover",
    });

    const rows = await t.query(api.inventory.dumpsRecent, {});
    expect(rows).toHaveLength(2);
    expect(rows[0].menu_item?.name).toBe("Paneer Tikka");
    // Newest first
    expect(rows[0].quantity).toBe(3);
    expect(rows[1].quantity).toBe(2);
  });
});
