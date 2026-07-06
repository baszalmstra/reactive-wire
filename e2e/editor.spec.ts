import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";

test.describe.serial("Reactive Wire editor with mock server", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    // The mock server's collaborative document is shared and persisted, so start from a clean
    // canvas no matter what a previous spec left behind.
    await clearCanvas(page);
  });

  test("adds a palette node and renders it on the canvas", async ({ page }) => {
    await page.getByRole("button", { name: /Number \+/ }).click();

    const numberNode = page.locator(".react-flow__node", { hasText: "Number" }).last();
    await expect(numberNode).toBeVisible();
    await expect(numberNode).toContainText(/Constant/i);
  });

  test("pans the canvas by default instead of marquee-selecting", async ({ page }) => {
    const viewport = page.locator(".react-flow__viewport");
    const before = await viewport.evaluate((el) => getComputedStyle(el).transform);

    await page.mouse.move(900, 500);
    await page.mouse.down();
    await page.mouse.move(1000, 580, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(".react-flow__selection")).toHaveCount(0);
    await expect.poll(() => viewport.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  });

  test("selects a Home Assistant entity from the node config picker", async ({ page }) => {
    await page.getByRole("button", { name: /^Entity \+$/ }).click();
    await expect(page.getByText("Choose entity", { exact: true })).toBeVisible();

    await page.getByRole("option", { name: /binary_sensor\.room_presence/ }).click();
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("Choose entity", { exact: true })).toHaveCount(0);
    await expect(page.locator(".react-flow__node", { hasText: "binary_sensor.room_presence" }).last()).toBeVisible();
  });

  test("keeps Home Assistant entity ids out of the palette", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Entity \+$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /sun\.sun \+/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /light\.bedroom \+/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /binary_sensor\.room_presence \+/ })).toHaveCount(0);
  });

  test("shows unavailable entity output warnings in the Problems panel", async ({ page }) => {
    await page.getByRole("button", { name: /^Entity \+$/ }).click();
    await page.locator('input[placeholder="domain.entity"]').last().fill("binary_sensor.definitely_missing");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByRole("button", { name: /△\s*[12]/ })).toBeVisible();
    await page.locator(".rw-problems").click();
    await expect(page.getByRole("button", { name: /Output 'state' is unavailable\./ })).toBeVisible();
  });

  test("syncs the server-owned auto-deploy setting between clients", async ({ page, context }) => {
    const autoDeploy = page.locator(".rw-autodeploy input");
    await page.locator(".rw-autodeploy").click();
    await expect(autoDeploy).toBeChecked();

    const second = await context.newPage();
    await second.goto("/");
    const secondAutoDeploy = second.locator(".rw-autodeploy input");
    await expect(secondAutoDeploy).toBeChecked();

    await second.locator(".rw-autodeploy").click();
    await expect(autoDeploy).not.toBeChecked();
  });
});
