import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

describe("orders.create — bill math", () => {
  test("computes subtotal from authoritative DB prices, ignoring qty math", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "dine_in",
      table_id: ids.tableId,
      items: [
        { menu_item_id: ids.trackedItemId, quantity: 2 }, // 200 * 2
        { menu_item_id: ids.untrackedItemId, quantity: 3 }, // 150 * 3
      ],
      ...ZERO_CHARGES,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotal).toBe(850);
    expect(order?.total).toBe(850);
    expect(order?.discount_amount).toBe(0);
    expect(order?.cgst_amount).toBe(0);
    expect(order?.sgst_amount).toBe(0);
  });

  test("applies discount before tax, then adds tips and charges last", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "dine_in",
      table_id: ids.tableId,
      items: [{ menu_item_id: ids.trackedItemId, quantity: 2 }], // subtotal 400
      discount_percent: 10, // -40 → taxable 360
      cgst_rate: 2.5, // +9
      sgst_rate: 2.5, // +9
      tips: 20,
      packing_charge: 0,
      delivery_charge: 0,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotal).toBe(400);
    expect(order?.discount_amount).toBe(40);
    expect(order?.cgst_amount).toBe(9);
    expect(order?.sgst_amount).toBe(9);
    expect(order?.total).toBe(398); // 360 + 9 + 9 + 20
  });

  test("delivery order: adds packing + delivery charges to total", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "delivery",
      customer_name: "Anu",
      customer_phone: "9999999999",
      delivery_address: "1 MG Rd",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }], // 150
      ...ZERO_CHARGES,
      packing_charge: 30,
      delivery_charge: 50,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotal).toBe(150);
    expect(order?.total).toBe(230);
  });
});

describe("orders.create — price authority & snapshotting", () => {
  test("snapshots name + price from the menu_item, not the client", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "dine_in",
      table_id: ids.tableId,
      items: [{ menu_item_id: ids.trackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const items = await t.run((ctx) =>
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Paneer Tikka");
    expect(items[0].price).toBe(200);
  });

  test("rejects inactive menu items", async () => {
    const t = makeTest();
    const ids = await seed(t);

    await expect(
      t.mutation(api.orders.create, {
        order_type: "takeaway",
        items: [{ menu_item_id: ids.inactiveItemId, quantity: 1 }],
        ...ZERO_CHARGES,
      })
    ).rejects.toThrow(/not available/i);
  });
});

describe("orders.create — order_number sequencing", () => {
  test("issues ORD-00001, ORD-00002, ... in order, zero-padded to 5 digits", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const first = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });
    const second = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const [a, b] = await t.run((ctx) =>
      Promise.all([ctx.db.get(first), ctx.db.get(second)])
    );
    expect(a?.order_number).toBe("ORD-00001");
    expect(b?.order_number).toBe("ORD-00002");
  });
});
