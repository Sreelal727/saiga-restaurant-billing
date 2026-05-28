import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeAuthedTest } from "./setup";

async function seedThreeCategories() {
  const { t } = await makeAuthedTest();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("menu_categories", {
      name: "Starters",
      display_order: 1,
      is_active: true,
    });
    const b = await ctx.db.insert("menu_categories", {
      name: "Main Course",
      display_order: 2,
      is_active: true,
    });
    const c = await ctx.db.insert("menu_categories", {
      name: "Desserts",
      display_order: 3,
      is_active: true,
    });
    return { a, b, c };
  });
  return { t, ids };
}

describe("categories.create", () => {
  test("trims whitespace from name", async () => {
    const { t } = await makeAuthedTest();
    const id = await t.mutation(api.categories.create, {
      name: "  Pizza  ",
      display_order: 1,
    });
    const cat = await t.run((ctx) => ctx.db.get(id));
    expect(cat?.name).toBe("Pizza");
  });

  test("rejects an empty name", async () => {
    const { t } = await makeAuthedTest();
    await expect(
      t.mutation(api.categories.create, { name: "   ", display_order: 1 })
    ).rejects.toThrow(/required/i);
  });
});

describe("categories.update", () => {
  test("renames a category and trims whitespace", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.update, {
      id: ids.a,
      name: "  Appetizers  ",
    });
    const cat = await t.run((ctx) => ctx.db.get(ids.a));
    expect(cat?.name).toBe("Appetizers");
  });

  test("rejects an empty rename", async () => {
    const { t, ids } = await seedThreeCategories();
    await expect(
      t.mutation(api.categories.update, { id: ids.a, name: "  " })
    ).rejects.toThrow(/cannot be empty/i);
  });

  test("toggles is_active", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.update, { id: ids.a, is_active: false });
    const cat = await t.run((ctx) => ctx.db.get(ids.a));
    expect(cat?.is_active).toBe(false);
  });
});

describe("categories.reorder", () => {
  test('moves a category up (swaps display_order with the one above)', async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.reorder, {
      id: ids.b,
      direction: "up",
    });
    const [a, b] = await t.run((ctx) =>
      Promise.all([ctx.db.get(ids.a), ctx.db.get(ids.b)])
    );
    expect(a?.display_order).toBe(2);
    expect(b?.display_order).toBe(1);
  });

  test('moves a category down', async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.reorder, {
      id: ids.b,
      direction: "down",
    });
    const [b, c] = await t.run((ctx) =>
      Promise.all([ctx.db.get(ids.b), ctx.db.get(ids.c)])
    );
    expect(b?.display_order).toBe(3);
    expect(c?.display_order).toBe(2);
  });

  test('is a no-op at the top boundary', async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.reorder, {
      id: ids.a,
      direction: "up",
    });
    const a = await t.run((ctx) => ctx.db.get(ids.a));
    expect(a?.display_order).toBe(1);
  });

  test('is a no-op at the bottom boundary', async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.reorder, {
      id: ids.c,
      direction: "down",
    });
    const c = await t.run((ctx) => ctx.db.get(ids.c));
    expect(c?.display_order).toBe(3);
  });
});

describe("categories.remove — orphan guard", () => {
  test("deletes an empty category", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.mutation(api.categories.remove, { id: ids.a });
    const cat = await t.run((ctx) => ctx.db.get(ids.a));
    expect(cat).toBeNull();
  });

  test("blocks deletion when items still reference the category", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.run((ctx) =>
      ctx.db.insert("menu_items", {
        category_id: ids.a,
        name: "Soup",
        price: 100,
        is_veg: true,
        is_active: true,
        has_inventory: false,
      })
    );

    await expect(
      t.mutation(api.categories.remove, { id: ids.a })
    ).rejects.toThrow(/still has menu items/i);

    // Category must still exist
    const cat = await t.run((ctx) => ctx.db.get(ids.a));
    expect(cat).not.toBeNull();
  });

  test("blocks even when the only referencing item is inactive", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.run((ctx) =>
      ctx.db.insert("menu_items", {
        category_id: ids.a,
        name: "Retired Special",
        price: 100,
        is_veg: true,
        is_active: false,
        has_inventory: false,
      })
    );

    await expect(
      t.mutation(api.categories.remove, { id: ids.a })
    ).rejects.toThrow(/still has menu items/i);
  });
});

describe("categories.listWithCounts", () => {
  test("returns each category with its item count", async () => {
    const { t, ids } = await seedThreeCategories();
    await t.run(async (ctx) => {
      await ctx.db.insert("menu_items", {
        category_id: ids.a,
        name: "Soup",
        price: 100,
        is_veg: true,
        is_active: true,
        has_inventory: false,
      });
      await ctx.db.insert("menu_items", {
        category_id: ids.a,
        name: "Salad",
        price: 120,
        is_veg: true,
        is_active: false, // inactive items still count
        has_inventory: false,
      });
    });

    const result = await t.query(api.categories.listWithCounts, {});
    const byName = Object.fromEntries(result.map((c) => [c.name, c.item_count]));
    expect(byName["Starters"]).toBe(2);
    expect(byName["Main Course"]).toBe(0);
    expect(byName["Desserts"]).toBe(0);
  });
});
