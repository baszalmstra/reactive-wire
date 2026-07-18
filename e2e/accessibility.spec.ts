import { expect, test } from "@playwright/test";
import { resetWorkspace } from "./collab-utils.js";
import { addNode, edges, moveNodeTo } from "./wiring-utils.js";

test.describe.serial("Keyboard graph accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await resetWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test("connects typed handles with Enter and Space and keeps node focus visible", async ({ page }) => {
    const source = await addNode(page, "Boolean");
    await moveNodeTo(page, source, 430, 300);
    const target = await addNode(page, "NOT");
    await moveNodeTo(page, target, 760, 430);
    await expect(target).toContainText("unavailable");

    const output = source.getByRole("button", { name: "Boolean: value output, boolean" });
    const input = target.getByRole("button", { name: "NOT: in input, boolean" });
    expect((await output.boundingBox())?.width).toBeGreaterThanOrEqual(28);
    await output.focus();
    await page.keyboard.press("Enter");
    await input.focus();
    await page.keyboard.press("Space");

    await expect(edges(page)).toHaveCount(1);
    await expect(target).toContainText("true");

    await target.focus();
    await expect(target).toHaveCSS("outline-style", "solid");
    await expect(target).not.toHaveCSS("outline-width", "0px");
  });

  test("supports roving flow tabs, F2 rename, and checkbox keyboard focus", async ({ page }) => {
    const first = page.getByRole("tab", { name: "Flow 1" });
    await expect(first).toHaveAttribute("aria-selected", "true");
    const panelId = await first.getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    await expect(page.locator(`#${panelId}`)).toHaveAttribute("aria-labelledby", await first.getAttribute("id") ?? "");

    await page.getByRole("button", { name: "New flow" }).click();
    const second = page.getByRole("tab", { name: "Flow 2" });
    await expect(second).toHaveAttribute("aria-selected", "true");
    await second.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(first).toBeFocused();

    await page.keyboard.press("F2");
    const editor = page.getByRole("textbox", { name: "Rename Flow 1" });
    await editor.fill("Kitchen");
    await editor.press("Enter");
    await expect(page.getByRole("tab", { name: "Kitchen" })).toBeVisible();

    const autoDeploy = page.getByRole("checkbox", { name: "auto-deploy" });
    await autoDeploy.focus();
    await expect(autoDeploy).toBeFocused();
    await expect(page.locator(".rw-checkbox")).toHaveCSS("outline-style", "solid");
  });

  test("exposes focused tooltips, large color targets, and reduced-motion styling", async ({ page }) => {
    const paletteButton = page.locator(".rw-palette-scroll button").first();
    await paletteButton.focus();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(paletteButton).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id") ?? "");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();

    await addNode(page, "Color");
    const blue = page.getByRole("button", { name: "Set color Blue" });
    const target = await blue.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(32);
    expect(target?.height).toBeGreaterThanOrEqual(32);

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await expect(page.locator(".rw-sidebar-wrap")).toHaveCSS("transition-duration", "0s");
  });
});
