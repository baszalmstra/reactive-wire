import { expect, test, type Locator } from "@playwright/test";
import { resetWorkspace } from "./collab-utils.js";
import { addNode, edges, moveNodeTo } from "./wiring-utils.js";

async function expectMinimumTarget(locator: Locator, minimum: number) {
  const box = await locator.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(minimum);
  expect(box?.height).toBeGreaterThanOrEqual(minimum);
}

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

  test("keeps destructive canvas shortcuts scoped while modal layers are open", async ({ page }) => {
    const mainCanvas = page.getByRole("tabpanel").locator(".react-flow__node");
    const number = await addNode(page, "Number");
    await number.focus();
    await expect(mainCanvas).toHaveCount(1);

    await page.getByRole("button", { name: "Deploy enabled" }).click();
    const deployDialog = page.getByRole("dialog", { name: "Deploy to your home" });
    await expect(deployDialog).toBeVisible();
    await deployDialog.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(mainCanvas).toHaveCount(1);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Entity \+$/ }).click();
    const configDialog = page.getByRole("dialog", { name: "Choose entity" });
    await expect(configDialog).toBeVisible();
    await configDialog.getByRole("button", { name: "Cancel" }).focus();
    const configuredCount = await mainCanvas.count();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(mainCanvas).toHaveCount(configuredCount);
    await page.keyboard.press("Escape");

    await number.locator(".rw-drag").click();
    const group = page.getByRole("button", { name: "Group" });
    await expect(group).toBeEnabled();
    await group.click();
    await expect(mainCanvas).toHaveCount(configuredCount);
    const placement = mainCanvas.filter({ hasText: "Macro 1" });
    await expect(placement).toHaveCount(1);
    await placement.locator(".rw-drag").dblclick();

    const macroDialog = page.getByRole("dialog", { name: "Editing macro" });
    await expect(macroDialog).toBeVisible();
    const macroNodes = macroDialog.locator(".react-flow__node");
    const before = await macroNodes.count();
    expect(before).toBeGreaterThan(0);
    const inner = macroNodes.first();
    await inner.click({ force: true });
    await expect(inner).toHaveClass(/selected/);
    await inner.focus();
    await page.keyboard.press("Delete");
    await expect(macroNodes).toHaveCount(before - 1);
    await expect(mainCanvas).toHaveCount(configuredCount);
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
    const kitchen = page.getByRole("tab", { name: "Kitchen" });
    await expect(kitchen).toBeFocused();

    await page.keyboard.press("F2");
    const cancelEditor = page.getByRole("textbox", { name: "Rename Kitchen" });
    await cancelEditor.fill("Discarded");
    await cancelEditor.press("Escape");
    await expect(kitchen).toBeFocused();

    await page.getByRole("button", { name: "Close Kitchen" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Close Kitchen?" })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(second).toBeFocused();

    const autoDeploy = page.getByRole("checkbox", { name: "auto-deploy" });
    await autoDeploy.focus();
    await expect(autoDeploy).toBeFocused();
    await expect(page.locator(".rw-checkbox")).toHaveCSS("outline-style", "solid");
  });

  test("exposes focused tooltips, large color targets, and reduced-motion styling", async ({ page, context }) => {
    const paletteButton = page.locator(".rw-palette-scroll button").first();
    await paletteButton.focus();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(paletteButton).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id") ?? "");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();

    await addNode(page, "Color");
    const blue = page.getByRole("button", { name: "Set color Blue" });
    await expectMinimumTarget(blue, 32);

    await expectMinimumTarget(page.getByRole("button", { name: /Flow 1 for deployment/ }), 24);
    await page.getByRole("button", { name: "New flow" }).click();
    const closeFlow = page.getByRole("button", { name: "Close Flow 2" });
    await expectMinimumTarget(closeFlow, 24);
    await page.getByRole("button", { name: "Comment" }).click();
    const deleteComment = page.getByRole("button", { name: "Delete comment" });
    await expectMinimumTarget(deleteComment, 24);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expectMinimumTarget(page.getByRole("button", { name: /Flow 1 for deployment/ }), 44);
    await expectMinimumTarget(page.getByRole("button", { name: "Rename Flow 1" }), 44);
    await expectMinimumTarget(closeFlow, 44);
    await expectMinimumTarget(deleteComment, 32);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await expect(page.locator(".rw-sidebar-wrap")).toHaveCSS("transition-duration", "0s");
  });
});
