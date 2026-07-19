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

  test("shows one outline for pointer-selected nodes", async ({ page }) => {
    await page.getByRole("button", { name: /Number \+/ }).click();
    await page.getByRole("button", { name: /Boolean \+/ }).click();

    const nodes = page.locator(".react-flow__node");
    const numberNode = nodes.filter({ hasText: "Number" }).last();
    const booleanNode = nodes.filter({ hasText: "Boolean" }).last();

    await numberNode.locator(".rw-drag").click();
    await expect(numberNode).toHaveClass(/selected/);
    await expect.poll(() => numberNode.evaluate((node) => node === document.activeElement)).toBe(true);
    await expect.poll(() => numberNode.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");

    await page.locator(".react-flow__pane").click({ position: { x: 650, y: 500 } });
    const boxes = await Promise.all([numberNode.boundingBox(), booleanNode.boundingBox()]);
    const [numberBox, booleanBox] = boxes;
    expect(numberBox).not.toBeNull();
    expect(booleanBox).not.toBeNull();
    const left = Math.min(numberBox!.x, booleanBox!.x) - 12;
    const top = Math.min(numberBox!.y, booleanBox!.y) - 12;
    const right = Math.max(numberBox!.x + numberBox!.width, booleanBox!.x + booleanBox!.width) + 12;
    const bottom = Math.max(numberBox!.y + numberBox!.height, booleanBox!.y + booleanBox!.height) + 12;

    await page.keyboard.down("Shift");
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(numberNode).toHaveClass(/selected/);
    await expect(booleanNode).toHaveClass(/selected/);
    const selectionRect = page.locator(".react-flow__nodesselection-rect");
    await expect(selectionRect).toBeVisible();
    await expect.poll(() => selectionRect.evaluate((rect) => getComputedStyle(rect).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
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

  test("keeps a long Problems list clear of the mobile bar", async ({ page }) => {
    for (let index = 0; index < 6; index += 1) {
      await page.getByRole("button", { name: /^Entity \+$/ }).click();
      await page.locator('input[placeholder="domain.entity"]').last().fill(`binary_sensor.definitely_missing_${index}`);
      await page.getByRole("button", { name: "Add" }).click();
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByLabel("Problems")).toBeVisible();
    await page.getByLabel("Problems").click();

    const panel = page.locator(".rw-problems-panel");
    const bar = page.locator(".rw-mobilebar");
    const content = panel.locator(".rw-problems-content");
    const rows = panel.locator(".rw-problem-row");
    await expect(panel).toBeVisible();
    await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(6);

    const [panelBox, barBox, closeBox, rowBox] = await Promise.all([
      panel.boundingBox(),
      bar.boundingBox(),
      page.getByLabel("Close problems").boundingBox(),
      rows.first().boundingBox(),
    ]);
    expect(panelBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(barBox!.y);
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);
    expect(rowBox!.height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(rows.first().locator(".rw-problem-message")).toHaveCSS("white-space", "normal");

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(rows.last()).toBeInViewport();
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
