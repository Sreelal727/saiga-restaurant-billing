import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

async function createDineInOrder() {
  const t = makeTest();
  const ids = await seed(t);
  const orderId = await t.mutation(api.orders.create, {
    order_type: "dine_in",
    table_id: ids.tableId,
    items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }], // 150
    ...ZERO_CHARGES,
  });
  return { t, ids, orderId };
}

describe("orders.addItems", () => {
  test("appends items and recalculates totals from the full item list", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.addItems, {
      id: orderId,
      items: [{ menu_item_id: ids.trackedItemId, quantity: 2 }], // 200*2 = 400
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotal).toBe(550);
    expect(order?.total).toBe(550);

    const itemRows = await t.run((ctx) =>
      ctx.db
        .query("order_items")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    expect(itemRows).toHaveLength(2);
  });

  test("blocks adding items to a paid order", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.recordPayment, {
      id: orderId,
      payment_method: "cash",
    });

    await expect(
      t.mutation(api.orders.addItems, {
        id: orderId,
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      })
    ).rejects.toThrow(/paid or cancelled/i);
  });

  test("blocks adding items to a cancelled order", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.updateStatus, {
      id: orderId,
      status: "cancelled",
    });

    await expect(
      t.mutation(api.orders.addItems, {
        id: orderId,
        items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      })
    ).rejects.toThrow(/paid or cancelled/i);
  });

  test("throws when adding under-stocked tracked items", async () => {
    const t = makeTest();
    const ids = await seed(t, { trackedStockQty: 1 });
    const orderId = await t.mutation(api.orders.create, {
      order_type: "dine_in",
      table_id: ids.tableId,
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    await expect(
      t.mutation(api.orders.addItems, {
        id: orderId,
        items: [{ menu_item_id: ids.trackedItemId, quantity: 5 }],
      })
    ).rejects.toThrow(/insufficient stock/i);
  });
});

describe("orders.updateCharges", () => {
  test("recomputes totals from the existing subtotal", async () => {
    const { t, orderId } = await createDineInOrder(); // subtotal 150

    await t.mutation(api.orders.updateCharges, {
      id: orderId,
      discount_percent: 10, // -15 → taxable 135
      tips: 25,
      packing_charge: 0,
      delivery_charge: 0,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotal).toBe(150);
    expect(order?.discount_amount).toBe(15);
    expect(order?.total).toBe(160); // 135 + 0 + 0 + 25
  });

  test("rejects negative charges", async () => {
    const { t, orderId } = await createDineInOrder();

    await expect(
      t.mutation(api.orders.updateCharges, {
        id: orderId,
        discount_percent: 0,
        tips: -5,
        packing_charge: 0,
        delivery_charge: 0,
      })
    ).rejects.toThrow(/cannot be negative/i);
  });

  test("rejects out-of-range discount", async () => {
    const { t, orderId } = await createDineInOrder();

    await expect(
      t.mutation(api.orders.updateCharges, {
        id: orderId,
        discount_percent: 120,
        tips: 0,
        packing_charge: 0,
        delivery_charge: 0,
      })
    ).rejects.toThrow(/discount_percent.*0.*100/i);
  });
});

describe("orders.updateStatus / recordPayment — table release", () => {
  test("updateStatus(paid) frees the table", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.updateStatus, { id: orderId, status: "paid" });

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
    expect(table?.current_order_id).toBeUndefined();
  });

  test("updateStatus(cancelled) frees the table", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.updateStatus, {
      id: orderId,
      status: "cancelled",
    });

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
    expect(table?.current_order_id).toBeUndefined();
  });

  test("non-terminal status (e.g. preparing) leaves the table occupied", async () => {
    const { t, ids, orderId } = await createDineInOrder();

    await t.mutation(api.orders.updateStatus, {
      id: orderId,
      status: "preparing",
    });

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("occupied");
    expect(table?.current_order_id).toBe(orderId);
  });

  test("recordPayment marks order paid, stamps paid_at, frees the table", async () => {
    const { t, ids, orderId } = await createDineInOrder();
    const before = Date.now();

    await t.mutation(api.orders.recordPayment, {
      id: orderId,
      payment_method: "upi",
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    expect(order?.payment_method).toBe("upi");
    expect(order?.paid_at).toBeGreaterThanOrEqual(before);

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
    expect(table?.current_order_id).toBeUndefined();
  });
});
