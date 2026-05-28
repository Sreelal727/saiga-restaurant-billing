import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed, ZERO_CHARGES } from "./fixtures";
import { makeTest, makeAuthedTest } from "./setup";

describe("customers.create + findByPhone", () => {
  test("creates a customer, trims fields, and is found by phone", async () => {
    const t = makeTest();
    const id = await t.mutation(api.customers.create, {
      name: "  Anu  ",
      phone: "  9999999999  ",
      email: " anu@example.com ",
      default_address: " 1 MG Rd ",
    });

    const found = await t.query(api.customers.findByPhone, {
      phone: "9999999999",
    });
    expect(found?._id).toBe(id);
    expect(found?.name).toBe("Anu");
    expect(found?.email).toBe("anu@example.com");
    expect(found?.default_address).toBe("1 MG Rd");
  });

  test("rejects empty name or phone", async () => {
    const t = makeTest();
    await expect(
      t.mutation(api.customers.create, { name: "   ", phone: "9999999999" })
    ).rejects.toThrow(/name is required/i);
    await expect(
      t.mutation(api.customers.create, { name: "Anu", phone: " " })
    ).rejects.toThrow(/phone is required/i);
  });

  test("rejects duplicate phone numbers", async () => {
    const t = makeTest();
    await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });
    await expect(
      t.mutation(api.customers.create, {
        name: "Anu Two",
        phone: "9999999999",
      })
    ).rejects.toThrow(/already exists/i);
  });
});

describe("customers.update", () => {
  test("updates fields and rejects empty name", async () => {
    const t = makeTest();
    const id = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });

    await t.mutation(api.customers.update, {
      id,
      name: "Anusha",
      default_address: "2 Brigade Rd",
    });
    const c = await t.run((ctx) => ctx.db.get(id));
    expect(c?.name).toBe("Anusha");
    expect(c?.default_address).toBe("2 Brigade Rd");

    await expect(
      t.mutation(api.customers.update, { id, name: "  " })
    ).rejects.toThrow(/cannot be empty/i);
  });

  test("blocks phone change if another customer already uses it", async () => {
    const t = makeTest();
    const a = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });
    await t.mutation(api.customers.create, {
      name: "Bina",
      phone: "8888888888",
    });

    await expect(
      t.mutation(api.customers.update, { id: a, phone: "8888888888" })
    ).rejects.toThrow(/another customer already uses/i);
  });
});

describe("customers.remove — orphan guard", () => {
  test("blocks delete when a linked order exists", async () => {
    const { t } = await makeAuthedTest();
    const ids = await seed(t);
    const customerId = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });

    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_id: customerId,
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    await expect(
      t.mutation(api.customers.remove, { id: customerId })
    ).rejects.toThrow(/linked to existing orders/i);
  });

  test("allows delete when no orders reference the customer", async () => {
    const { t } = await makeAuthedTest();
    const id = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });
    await t.mutation(api.customers.remove, { id });
    const c = await t.run((ctx) => ctx.db.get(id));
    expect(c).toBeNull();
  });
});

describe("orders.create — customer auto-link", () => {
  test("links explicit customer_id and preserves denormalized fields", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const customerId = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });

    const orderId = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_id: customerId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.customer_id).toBe(customerId);
    expect(order?.customer_name).toBe("Anu");
  });

  test("auto-creates a customer when phone+name given without customer_id", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "delivery",
      customer_name: "Bina",
      customer_phone: "7777777777",
      delivery_address: "3 Church St",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.customer_id).toBeDefined();

    const customer = await t.query(api.customers.findByPhone, {
      phone: "7777777777",
    });
    expect(customer?._id).toBe(order?.customer_id);
    expect(customer?.name).toBe("Bina");
    expect(customer?.default_address).toBe("3 Church St");
  });

  test("does not auto-create when phone is given but name is missing", async () => {
    const t = makeTest();
    const ids = await seed(t);

    const orderId = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_phone: "6666666666",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.customer_id).toBeUndefined();

    const customer = await t.query(api.customers.findByPhone, {
      phone: "6666666666",
    });
    expect(customer).toBeNull();
  });

  test("re-uses existing customer when phone matches", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const customerId = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });

    const orderId = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_name: "Anu Different Capitalisation",
      customer_phone: "9999999999",
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }],
      ...ZERO_CHARGES,
    });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.customer_id).toBe(customerId);

    // Existing customer's name is not overwritten by the order
    const customer = await t.run((ctx) => ctx.db.get(customerId));
    expect(customer?.name).toBe("Anu");
  });
});

describe("customers.listWithStats", () => {
  test("returns total_spent and counts including only paid orders", async () => {
    const t = makeTest();
    const ids = await seed(t);
    const customerId = await t.mutation(api.customers.create, {
      name: "Anu",
      phone: "9999999999",
    });

    const o1 = await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_id: customerId,
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 1 }], // 150
      ...ZERO_CHARGES,
    });
    // Pay one, leave another pending
    await t.mutation(api.orders.recordPayment, {
      id: o1,
      payment_method: "cash",
    });

    await t.mutation(api.orders.create, {
      order_type: "takeaway",
      customer_id: customerId,
      items: [{ menu_item_id: ids.untrackedItemId, quantity: 2 }], // 300, unpaid
      ...ZERO_CHARGES,
    });

    const rows = await t.query(api.customers.listWithStats, {});
    const row = rows.find((r) => r._id === customerId)!;
    expect(row.order_count).toBe(2);
    expect(row.paid_order_count).toBe(1);
    expect(row.total_spent).toBe(150);
  });
});
