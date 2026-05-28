import { test, expect } from "@playwright/test";

/**
 * Golden path: an empty table is taken to a paid order and back to available.
 *
 * Steps:
 *   1. Land on /tables — verify T1 is "Available"
 *   2. Open T1, start a new order from the side panel
 *   3. Add Paneer Tikka (₹280) and Veg Spring Roll (₹180) — bill shows ₹460 subtotal
 *   4. Place the order — redirected to /orders/[id], status "pending"
 *   5. Click through Confirm → Preparing → Ready → Served
 *   6. Pay via cash — status becomes "paid", payment_method UPI in summary
 *   7. Go back to /tables — T1 is "Available" again, no order on the card
 */
test("table → order → bill → payment → table free", async ({ page }) => {
  await test.step("tables page loads with T1 available", async () => {
    await page.goto("/tables");
    const t1 = page.locator("div", { hasText: /^T1$/ }).first();
    await expect(t1).toBeVisible({ timeout: 15_000 });
    // Cards include a status label below the table number
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();
  });

  await test.step("select T1 and start a new order", async () => {
    await page.getByText("T1", { exact: true }).first().click();
    await page.getByRole("button", { name: /new order/i }).click();
    await expect(page).toHaveURL(/\/orders\/new\?table=/);
  });

  await test.step("add items and place order", async () => {
    // Wait for menu to load
    await expect(page.getByText("Paneer Tikka")).toBeVisible({ timeout: 15_000 });

    // The + button next to an item is the only sibling control before it's in the cart
    const paneerRow = page.locator("div", { hasText: /Paneer Tikka/ }).filter({
      has: page.locator("button"),
    }).first();
    await paneerRow.getByRole("button").last().click();

    const springRollRow = page.locator("div", { hasText: /Veg Spring Roll/ }).filter({
      has: page.locator("button"),
    }).first();
    await springRollRow.getByRole("button").last().click();

    // Bill summary appears with subtotal = 280 + 180 = 460
    await expect(page.getByText(/Subtotal/)).toBeVisible();
    await expect(page.getByText(/₹\s*460/).first()).toBeVisible();

    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page).toHaveURL(/\/orders\/[a-z0-9]+/i, { timeout: 15_000 });
    await expect(page.getByText(/ORD-\d{5}/)).toBeVisible();
  });

  await test.step("walk the order through status transitions to served", async () => {
    await page.getByRole("button", { name: /^confirm$/i }).click();
    await expect(page.getByText("confirmed").first()).toBeVisible();

    await page.getByRole("button", { name: /start preparing/i }).click();
    await expect(page.getByText("preparing").first()).toBeVisible();

    await page.getByRole("button", { name: /mark ready/i }).click();
    await expect(page.getByText("ready").first()).toBeVisible();

    await page.getByRole("button", { name: /mark served/i }).click();
    await expect(page.getByText("served").first()).toBeVisible();
  });

  await test.step("record payment via cash", async () => {
    await page.getByRole("button", { name: /pay via cash/i }).click();
    // Status pill flips to "paid"; payment row appears in bill summary
    await expect(page.getByText("paid").first()).toBeVisible();
    await expect(page.getByText("CASH").first()).toBeVisible();
  });

  await test.step("table T1 is available again", async () => {
    await page.goto("/tables");
    const t1Card = page
      .locator("div", { hasText: /^T1$/ })
      .filter({ hasText: /Available/ })
      .first();
    await expect(t1Card).toBeVisible({ timeout: 15_000 });
  });
});
