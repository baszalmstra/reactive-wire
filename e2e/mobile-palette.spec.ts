import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";

test.describe("Mobile node palette", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await clearCanvas(page);
  });

  test.afterEach(async ({ page }) => {
    await clearCanvas(page);
  });

  test("closes after adding a node so the canvas is visible", async ({ page }) => {
    await page.getByRole("button", { name: "Nodes", exact: true }).click();
    await expect(page.locator("#rw-root")).toHaveClass(/nav-open/);

    await page.getByRole("button", { name: /^Number \+$/ }).click();

    await expect(page.locator("#rw-root")).not.toHaveClass(/nav-open/);
    await expect(page.locator(".react-flow__node", { hasText: "Number" }).last()).toBeVisible();
  });
});
