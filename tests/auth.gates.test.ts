import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { seed } from "./fixtures";
import { makeTest, makeAuthedTest } from "./setup";

/**
 * Smoke tests for the manager-only gates. Unauthenticated callers should be
 * rejected; authenticated callers with role=manager should succeed; callers
 * authenticated as cashier or waiter should also be rejected.
 */

describe("settings.upsert — manager-only", () => {
  test("rejects unauthenticated callers", async () => {
    const t = makeTest();
    await expect(
      t.mutation(api.settings.upsert, {
        restaurant_name: "Saiga",
        cgst_rate: 2.5,
        sgst_rate: 2.5,
        default_packing_charge: 0,
        default_delivery_charge: 0,
        currency: "₹",
      })
    ).rejects.toThrow(/authentication required/i);
  });

  test("rejects a cashier", async () => {
    const { t } = await makeAuthedTest("cashier");
    await expect(
      t.mutation(api.settings.upsert, {
        restaurant_name: "Saiga",
        cgst_rate: 2.5,
        sgst_rate: 2.5,
        default_packing_charge: 0,
        default_delivery_charge: 0,
        currency: "₹",
      })
    ).rejects.toThrow(/manager role required/i);
  });

  test("accepts a manager", async () => {
    const { t } = await makeAuthedTest("manager");
    await t.mutation(api.settings.upsert, {
      restaurant_name: "Saiga",
      cgst_rate: 2.5,
      sgst_rate: 2.5,
      default_packing_charge: 0,
      default_delivery_charge: 0,
      currency: "₹",
    });
    const settings = await t.query(api.settings.get, {});
    expect(settings?.restaurant_name).toBe("Saiga");
  });
});

describe("menu.bulkRemove — manager-only", () => {
  test("rejects a waiter", async () => {
    const { t } = await makeAuthedTest("waiter");
    const ids = await seed(t);
    await expect(
      t.mutation(api.menu.bulkRemove, { ids: [ids.untrackedItemId] })
    ).rejects.toThrow(/manager role required/i);
  });

  test("rejects unauthenticated", async () => {
    const t = makeTest();
    const ids = await seed(t);
    await expect(
      t.mutation(api.menu.bulkRemove, { ids: [ids.untrackedItemId] })
    ).rejects.toThrow(/authentication required/i);
  });
});

describe("users.currentStaff", () => {
  test("returns null without a session", async () => {
    const t = makeTest();
    const result = await t.query(api.users.currentStaff, {});
    expect(result).toBeNull();
  });

  test("returns staff role for an authenticated manager", async () => {
    const { t } = await makeAuthedTest("manager");
    const result = await t.query(api.users.currentStaff, {});
    expect(result?.role).toBe("manager");
    expect(result?.username).toBe("test-manager");
  });

  test("returns staff role for an authenticated cashier", async () => {
    const { t } = await makeAuthedTest("cashier");
    const result = await t.query(api.users.currentStaff, {});
    expect(result?.role).toBe("cashier");
  });
});
