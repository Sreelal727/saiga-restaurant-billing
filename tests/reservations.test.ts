import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed } from "./fixtures";
import { makeTest } from "./setup";

const HOUR_MS = 60 * 60 * 1000;

async function setupTable() {
  const t = makeTest();
  const ids = await seed(t);
  // Use tomorrow at 19:00 as the canonical reservation slot
  const tomorrow19 = new Date();
  tomorrow19.setDate(tomorrow19.getDate() + 1);
  tomorrow19.setHours(19, 0, 0, 0);
  return { t, ids, slot: tomorrow19.getTime() };
}

describe("reservations.create", () => {
  test("creates a confirmed reservation and auto-links the customer", async () => {
    const { t, ids, slot } = await setupTable();

    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });

    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r?.status).toBe("confirmed");
    expect(r?.duration_minutes).toBe(90);
    expect(r?.customer_id).toBeDefined();

    const customer = await t.query(api.customers.findByPhone, {
      phone: "9999999999",
    });
    expect(customer?._id).toBe(r?.customer_id);
  });

  test("rejects empty name, phone, or non-positive party size", async () => {
    const { t, ids, slot } = await setupTable();
    await expect(
      t.mutation(api.reservations.create, {
        table_id: ids.tableId,
        customer_name: "  ",
        customer_phone: "9999999999",
        party_size: 4,
        scheduled_at: slot,
      })
    ).rejects.toThrow(/name is required/i);
    await expect(
      t.mutation(api.reservations.create, {
        table_id: ids.tableId,
        customer_name: "Anu",
        customer_phone: "  ",
        party_size: 4,
        scheduled_at: slot,
      })
    ).rejects.toThrow(/phone is required/i);
    await expect(
      t.mutation(api.reservations.create, {
        table_id: ids.tableId,
        customer_name: "Anu",
        customer_phone: "9999999999",
        party_size: 0,
        scheduled_at: slot,
      })
    ).rejects.toThrow(/party size/i);
  });
});

describe("reservations conflict detection", () => {
  test("rejects an overlapping reservation on the same table", async () => {
    const { t, ids, slot } = await setupTable();
    await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
      duration_minutes: 60,
    });

    // 30 minutes after the first slot — still overlapping
    await expect(
      t.mutation(api.reservations.create, {
        table_id: ids.tableId,
        customer_name: "Bina",
        customer_phone: "8888888888",
        party_size: 2,
        scheduled_at: slot + 30 * 60_000,
        duration_minutes: 60,
      })
    ).rejects.toThrow(/already booked/i);
  });

  test("allows a back-to-back booking that starts exactly when the previous ends", async () => {
    const { t, ids, slot } = await setupTable();
    await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
      duration_minutes: 60,
    });

    // Starts exactly 1h later — no overlap
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Bina",
      customer_phone: "8888888888",
      party_size: 2,
      scheduled_at: slot + 60 * 60_000,
      duration_minutes: 60,
    });
    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r?.status).toBe("confirmed");
  });

  test("a cancelled reservation does not block the same table being re-booked", async () => {
    const { t, ids, slot } = await setupTable();
    const first = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });
    await t.mutation(api.reservations.cancel, { id: first });

    const replacement = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Bina",
      customer_phone: "8888888888",
      party_size: 2,
      scheduled_at: slot,
    });
    const r = await t.run((ctx) => ctx.db.get(replacement));
    expect(r?.status).toBe("confirmed");
  });
});

describe("reservations status transitions", () => {
  test("markSeated occupies the table", async () => {
    const { t, ids, slot } = await setupTable();
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });

    await t.mutation(api.reservations.markSeated, { id });

    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r?.status).toBe("seated");
    const table = await t.run((ctx) => ctx.db.get(ids.tableId));
    expect(table?.status).toBe("occupied");
  });

  test("markSeated rejects when the table is already occupied", async () => {
    const { t, ids, slot } = await setupTable();
    await t.run((ctx) => ctx.db.patch(ids.tableId, { status: "occupied" }));

    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });

    await expect(
      t.mutation(api.reservations.markSeated, { id })
    ).rejects.toThrow(/occupied/i);
  });

  test("cancel can only happen before seating", async () => {
    const { t, ids, slot } = await setupTable();
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });
    await t.mutation(api.reservations.markSeated, { id });
    await expect(
      t.mutation(api.reservations.cancel, { id })
    ).rejects.toThrow(/seated/i);
  });

  test("markNoShow flips a confirmed reservation", async () => {
    const { t, ids, slot } = await setupTable();
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });
    await t.mutation(api.reservations.markNoShow, { id });
    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r?.status).toBe("no_show");
  });

  test("remove allows deleting cancelled / no-show; blocks otherwise", async () => {
    const { t, ids, slot } = await setupTable();
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
    });

    await expect(
      t.mutation(api.reservations.remove, { id })
    ).rejects.toThrow(/cancelled or no-show/i);

    await t.mutation(api.reservations.cancel, { id });
    await t.mutation(api.reservations.remove, { id });
    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r).toBeNull();
  });
});

describe("reservations.update — conflict on time change", () => {
  test("blocks moving a reservation onto an existing one", async () => {
    const { t, ids, slot } = await setupTable();
    await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
      duration_minutes: 60,
    });
    const second = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Bina",
      customer_phone: "8888888888",
      party_size: 2,
      scheduled_at: slot + 2 * HOUR_MS,
      duration_minutes: 60,
    });

    await expect(
      t.mutation(api.reservations.update, {
        id: second,
        scheduled_at: slot + 30 * 60_000, // would overlap with the first
      })
    ).rejects.toThrow(/already booked/i);
  });

  test("permits editing the same reservation in place", async () => {
    const { t, ids, slot } = await setupTable();
    const id = await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: slot,
      duration_minutes: 60,
    });
    await t.mutation(api.reservations.update, {
      id,
      scheduled_at: slot + 15 * 60_000,
    });
    const r = await t.run((ctx) => ctx.db.get(id));
    expect(r?.scheduled_at).toBe(slot + 15 * 60_000);
  });
});

describe("reservations.listNextPerTable", () => {
  test("returns the next upcoming reservation per table within the horizon", async () => {
    const { t, ids } = await setupTable();
    const now = Date.now();

    await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Anu",
      customer_phone: "9999999999",
      party_size: 4,
      scheduled_at: now + 2 * HOUR_MS,
    });
    await t.mutation(api.reservations.create, {
      table_id: ids.tableId,
      customer_name: "Cindy",
      customer_phone: "7777777777",
      party_size: 2,
      scheduled_at: now + 5 * HOUR_MS,
    });

    const result = await t.query(api.reservations.listNextPerTable, {
      withinMs: 6 * HOUR_MS,
    });
    expect(result).toHaveLength(1);
    expect(result[0].customer_name).toBe("Anu"); // the sooner one wins
  });
});
