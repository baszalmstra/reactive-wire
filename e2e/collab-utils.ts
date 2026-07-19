import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Restore the shared collaborative document to a single empty flow. The mock server persists one
 * document across pages, reloads, and specs, so a spec that opens extra flows or leaves nodes on
 * the canvas must undo both or it bleeds into the next test (including the sibling specs that rely
 * on the plain clearCanvas helper). Run this from both beforeEach and afterEach.
 */
export async function resetWorkspace(page: Page): Promise<void> {
  // Dismiss any lingering modal (node config popup, deploy guard) that would eat canvas clicks.
  const overlay = page.locator("div.fixed.inset-0");
  for (let i = 0; i < 4 && (await overlay.count()) > 0; i++) {
    await page.keyboard.press("Escape");
    if ((await overlay.count()) === 0) break;
    await page.mouse.click(4, 4);
  }
  // Auto-deploy is server-owned document state, so visual cleanup alone is insufficient. Always
  // return it to the safe manual policy before normalizing the enabled flow set.
  const autoDeploy = page.getByRole("checkbox", { name: "auto-deploy" });
  if (await autoDeploy.isChecked()) await autoDeploy.click();
  await expect(autoDeploy).not.toBeChecked();

  // Collapse to a single flow: the strip only renders a close control while more than one flow
  // exists, so closing the second-to-last flow drops the close-control count straight to zero
  // rather than by one. Just close controls until none remain.
  const closeButtons = page.locator('button[title="Close flow"]');
  for (let guard = 0; guard < 64 && (await closeButtons.count()) > 0; guard++) {
    const before = await closeButtons.count();
    await closeButtons.first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Close flow" }).click();
    await expect.poll(() => closeButtons.count(), { timeout: 5_000 }).toBeLessThan(before);
  }
  // Normalize the surviving flow's name to the default so every spec starts from a canonical state
  // and `addFlow`'s count-based naming ("Flow 2", "Flow 3", …) stays predictable — otherwise a flow
  // a prior test renamed would leak its name into the next test.
  const strip = page.locator('button[aria-label="New flow"]').locator("xpath=..");
  const soleTab = strip.locator("div[title]").first();
  if ((await soleTab.getAttribute("title")) !== "Flow 1") {
    await soleTab.dblclick();
    const editor = strip.getByRole("textbox");
    await editor.fill("Flow 1");
    await editor.press("Enter");
    await expect(strip.locator('div[title="Flow 1"]')).toBeVisible();
  }
  // Closing the first close control can remove the previously enabled flow and leave a disabled
  // survivor. Explicitly enable the canonical survivor so later deploy specs cannot inherit an
  // empty deployment set merely because another spec created a second flow.
  const enableSurvivor = page.getByRole("button", { name: "Enable Flow 1 for deployment" });
  if (await enableSurvivor.count()) await enableSurvivor.click();
  await expect(page.getByRole("button", { name: "Disable Flow 1 for deployment" })).toBeVisible();

  // Empty the surviving flow. Force the click so two nodes dropped at the exact same point (e.g.
  // two clients that both added a node at the default drop position) can't shield one another's
  // drag handle from the actionability check.
  const nodes = page.locator(".react-flow__node");
  for (let remaining = await nodes.count(); remaining > 0; remaining--) {
    await nodes.first().locator(".rw-drag").click({ force: true });
    await page.keyboard.press("Delete");
    await expect(nodes).toHaveCount(remaining - 1);
  }
  // Let the debounced local→server flush carry the emptied document and normalized settings back
  // to the shared doc, then assert the complete canonical state instead of only visible content.
  await page.waitForTimeout(500);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Flow 1" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Disable Flow 1 for deployment" })).toBeVisible();
  await expect(autoDeploy).not.toBeChecked();
  await expect(nodes).toHaveCount(0);
}

/**
 * Add a constant "Number" node from the palette and return its React Flow node handle plus the
 * document id the collab layer keys it by. The caller is expected to start from a canvas holding no
 * other Number node so `.last()` resolves the one just added.
 */
export async function addNumberNode(page: Page): Promise<{ node: Locator; id: string }> {
  await page.getByRole("button", { name: /Number \+/ }).click();
  const node = page.locator(".react-flow__node", { hasText: "Number" }).last();
  await expect(node).toBeVisible();
  const id = await node.getAttribute("data-id");
  if (!id) throw new Error("new Number node has no data-id");
  return { node, id };
}

/** The flow-space transform React Flow writes onto a node wrapper, e.g. "translate(160px, 120px)". */
export function nodeTransform(page: Page, id: string): Promise<string> {
  return page
    .locator(`.react-flow__node[data-id="${id}"]`)
    .evaluate((el) => (el as HTMLElement).style.transform);
}
