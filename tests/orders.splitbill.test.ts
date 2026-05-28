import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest } from "./setup";

async function createServedOrder(amount = 400) {
  const t = makeTest();
  const ids = await seed(t);
  // amount = trackedItem price (200) * qty
  const qty = Math.round(amount / 200);
  const orderId = await t.mutation(api.orders.create, {
    order_type: "dine_in",
    table_id: ids.tableId,
    items: [{ menu_item_id: ids.trackedItemId, quantity: qty }],
    ...ZERO_CHARGES,
  });
  return { t, ids, orderId };
}

describe("orders.addPayment — single full payment", () => {
  test("a single payment covering the full balance flips status to paid", async () => {
    const { t, ids, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 400,
      method: "cash",
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    expect(order?.payment_method).toBe("cash");
    expect(order?.paid_at).toBeDefined();

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
  });

  test("a partial payment leaves status unchanged and table occupied", async () => {
    const { t, ids, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 150,
      method: "cash",
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("pending"); // initial status from create
    expect(order?.payment_method).toBeUndefined();

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("occupied");
  });
});

describe("orders.addPayment — even split", () => {
  test("two equal payments of half each fully pays the order", async () => {
    const { t, ids, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 200,
      method: "cash",
      payer_name: "Anu",
    });
    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 200,
      method: "upi",
      payer_name: "Bina",
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    expect(order?.payment_method).toBe("upi"); // last payment wins snapshot

    const payments = await t.run((ctx) =>
      ctx.db
        .query("order_payments")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    expect(payments).toHaveLength(2);
    expect(payments.map((p) => p.payer_name).sort()).toEqual(["Anu", "Bina"]);

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
  });
});

describe("orders.addPayment — uneven 3-way split", () => {
  test("three uneven payments summing to the total fully pay the order", async () => {
    const { t, orderId } = await createServedOrder(600);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 100,
      method: "cash",
    });
    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 200,
      method: "card",
    });

    // Mid-way, order is still not paid
    let order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("pending");

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 300,
      method: "upi",
    });
    order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
  });
});

describe("orders.addPayment — overpayment guard", () => {
  test("rejects a payment that exceeds the remaining balance", async () => {
    const { t, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 300,
      method: "cash",
    });

    await expect(
      t.mutation(api.orders.addPayment, {
        id: orderId,
        amount: 200, // balance is 100
        method: "upi",
      })
    ).rejects.toThrow(/exceeds balance/i);
  });

  test("rejects a non-positive payment", async () => {
    const { t, orderId } = await createServedOrder(400);
    await expect(
      t.mutation(api.orders.addPayment, {
        id: orderId,
        amount: 0,
        method: "cash",
      })
    ).rejects.toThrow(/must be positive/i);
  });

  test("rejects payment on a cancelled order", async () => {
    const { t, orderId } = await createServedOrder(400);
    await t.mutation(api.orders.updateStatus, {
      id: orderId,
      status: "cancelled",
    });
    await expect(
      t.mutation(api.orders.addPayment, {
        id: orderId,
        amount: 400,
        method: "cash",
      })
    ).rejects.toThrow(/cancelled/i);
  });
});

describe("orders.removePayment", () => {
  test("removing one of two payments reverts a paid order to served", async () => {
    const { t, ids, orderId } = await createServedOrder(400);

    const p1 = await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 200,
      method: "cash",
    });
    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 200,
      method: "upi",
    });

    // Order should now be paid
    let order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    let table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");

    await t.mutation(api.orders.removePayment, { id: p1 });

    order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("served");
    expect(order?.payment_method).toBeUndefined();

    // Table is re-occupied since the order is back in service
    table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("occupied");
    expect(table?.current_order_id).toBe(orderId);
  });
});

describe("orders.get — enriched payments fields", () => {
  test("returns payments array, total_paid and balance_due", async () => {
    const { t, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.addPayment, {
      id: orderId,
      amount: 150,
      method: "cash",
    });

    const enriched = await t.query(api.orders.get, { id: orderId });
    expect(enriched?.payments).toHaveLength(1);
    expect(enriched?.total_paid).toBe(150);
    expect(enriched?.balance_due).toBe(250);
  });
});

describe("orders.recordPayment — legacy shim", () => {
  test("still works as a single-shot full payment", async () => {
    const { t, ids, orderId } = await createServedOrder(400);

    await t.mutation(api.orders.recordPayment, {
      id: orderId,
      payment_method: "card",
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("paid");
    expect(order?.payment_method).toBe("card");

    const payments = await t.run((ctx) =>
      ctx.db
        .query("order_payments")
        .withIndex("by_order", (q) => q.eq("order_id", orderId))
        .collect()
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(400);

    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("available");
  });
});
