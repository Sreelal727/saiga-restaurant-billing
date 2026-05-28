import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

describe("orders.create — input validation", () => {
  test("rejects empty items array", async () => {
    const t = makeTest();
    await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [],
        ...ZERO_CHARGES,
      })
    ).rejects.toThrow(/at least one item/i);
  });

  test("rejects discount_percent below 0", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
        ...ZERO_CHARGES,
        discount_percent: -1,
      })
    ).rejects.toThrow(/discount_percent.*0.*100/i);
  });

  test("rejects discount_percent above 100", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
        ...ZERO_CHARGES,
        discount_percent: 150,
      })
    ).rejects.toThrow(/discount_percent.*0.*100/i);
  });

  test("rejects negative tips, packing or delivery charges", async () => {
    const t = makeTest();
    const ids = await seed(t);

    for (const field of ["tips", "packing_charge", "delivery_charge"] as const) {
      await expect(
        t.mutation(api.orders.create, {
          order_type: "takeaway",
          items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
          ...ZERO_CHARGES,
          [field]: -1,
        })
      ).rejects.toThrow(/cannot be negative/i);
    }
  });

  test("rejects non-integer quantity", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 1.5 }],
        ...ZERO_CHARGES,
      })
    ).rejects.toThrow(/quantity/i);
  });

  test("rejects zero quantity", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 0 }],
        ...ZERO_CHARGES,
      })
    ).rejects.toThrow(/quantity/i);
  });
});
