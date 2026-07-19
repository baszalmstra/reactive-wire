import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";

const phoneViewports = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
] as const;

async function expectInsideViewport(page: Page, locator: Locator, inset = 8) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(inset);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - inset);
}

for (const viewport of phoneViewports) {
  test.describe(`Mobile dialogs at ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
    });

    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await expect(page.getByLabel("Home Assistant connected")).toHaveClass(/online/);
      await clearCanvas(page);
      const scrim = page.locator(".rw-scrim");
      if (await scrim.isVisible()) await scrim.click({ position: { x: viewport.width - 1, y: 1 } });
    });

    test("keeps dialog content and actions inside the viewport", async ({ page }) => {
      const longEntityId = `binary_sensor.${"very_long_entity_id_".repeat(5)}`;

      await page.getByRole("button", { name: "Nodes" }).click();
      await page.getByRole("button", { name: /^Entity \+$/ }).click();
      const entityDialog = page.getByRole("dialog", { name: "Choose entity" });
      await entityDialog.getByPlaceholder("domain.entity").fill(longEntityId);

      await expectInsideViewport(page, entityDialog);
      await expectInsideViewport(page, entityDialog.getByRole("button", { name: "Cancel" }), 0);
      await expectInsideViewport(page, entityDialog.getByRole("button", { name: "Add" }), 0);
      await entityDialog.getByRole("button", { name: "Add" }).click();

      await page.locator(".rw-scrim").click({ position: { x: viewport.width - 1, y: 1 } });
      await page.getByRole("button", { name: "Deploy enabled" }).click();
      const deployDialog = page.getByRole("dialog", { name: "Deploy to your home" });
      await expect(deployDialog).toContainText(longEntityId);

      await expectInsideViewport(page, deployDialog);
      await expectInsideViewport(page, deployDialog.getByRole("button", { name: "Close deploy dialog" }), 0);
      await expectInsideViewport(page, deployDialog.getByRole("button", { name: "Cancel" }), 0);
      await expectInsideViewport(page, deployDialog.getByRole("button").last(), 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  });
}
