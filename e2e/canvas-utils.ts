import { expect, type Page } from "@playwright/test";

/**
 * Dismiss any open modal overlay (node config popup, deploy guard) so it no longer intercepts
 * canvas clicks. These modals cancel on a backdrop mousedown rather than on Escape, so try Escape
 * first and fall back to a click in the backdrop corner.
 */
async function dismissModals(page: Page): Promise<void> {
  const overlay = page.locator("div.fixed.inset-0");
  for (let i = 0; i < 6 && (await overlay.count()) > 0; i++) {
    await page.keyboard.press("Escape");
    if ((await overlay.count()) === 0) break;
    await page.mouse.click(4, 4);
  }
}

/**
 * Reset the canvas to empty: dismiss any lingering modal, then delete every node one at a time.
 * Runs from each spec's beforeEach so a spec starts clean regardless of what a previous spec left
 * behind (the mock server's collaborative document is shared and persisted) or where it failed.
 */
export async function clearCanvas(page: Page): Promise<void> {
  await dismissModals(page);
  const nodes = page.locator(".react-flow__node");
  let cleared = 0;
  for (let remaining = await nodes.count(); remaining > 0; remaining--) {
    await nodes.first().locator(".rw-drag").click();
    await page.keyboard.press("Delete");
    await expect(nodes).toHaveCount(remaining - 1);
    cleared++;
  }
  // Let the debounced local→server document flush carry the emptied canvas back to the shared doc.
  if (cleared > 0) await page.waitForTimeout(500);
}
