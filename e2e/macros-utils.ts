import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Delete every macro definition from the palette's Macros list. The mock server's collaborative
 * document persists macro definitions independently of canvas nodes, so a spec that starts from a
 * clean canvas (clearCanvas) must also drop the shared macro library, or definitions created by a
 * previous spec leak in and shift the auto-generated "Macro N" names.
 */
export async function clearMacros(page: Page): Promise<void> {
  const del = page.locator('button[title="Delete macro"]');
  for (let remaining = await del.count(); remaining > 0; remaining--) {
    await del.first().click();
    await expect(del).toHaveCount(remaining - 1);
  }
  // Let the debounced local→server document flush carry the emptied library back to the shared doc.
  await page.waitForTimeout(400);
}

/** Add a palette node by its button label (e.g. /^Number \+$/) and return the newest matching node. */
export async function addNode(page: Page, button: RegExp, nodeText: string | RegExp): Promise<Locator> {
  await page.getByRole("button", { name: button }).click();
  const node = page.locator(".react-flow__node", { hasText: nodeText }).last();
  await expect(node).toBeVisible();
  return node;
}

/** Drag a node by its header to an absolute screen position, spreading nodes so handles don't overlap. */
export async function moveNode(page: Page, node: Locator, x: number, y: number): Promise<void> {
  const box = await node.locator(".rw-drag").boundingBox();
  if (!box) throw new Error("node has no drag handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

/** Drag a wire from one node's output pin to another node's input pin (React Flow handles). */
export async function wire(page: Page, from: Locator, fromPin: string, to: Locator, toPin: string): Promise<void> {
  const s = await from.locator(`.react-flow__handle[data-handleid="${fromPin}"]`).boundingBox();
  const d = await to.locator(`.react-flow__handle[data-handleid="${toPin}"]`).boundingBox();
  if (!s || !d) throw new Error(`missing handle: ${fromPin} -> ${toPin}`);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 18 });
  await page.mouse.up();
}

/** Click a node's header to select it (optionally adding to the selection with Shift). */
export async function selectNode(page: Page, node: Locator, opts: { add?: boolean } = {}): Promise<void> {
  await node.locator(".rw-drag").click(opts.add ? { modifiers: ["Shift"] } : {});
}

/**
 * Build the reference graph for macro tests: a Number source, a middle Sum, and a downstream Sum,
 * wired Number → mid → down. Selecting just the middle Sum and grouping derives one macro input
 * (the wire entering it) and one output (the wire leaving it). Returns the three node locators.
 */
export async function buildChain(page: Page): Promise<{ num: Locator; mid: Locator; down: Locator }> {
  const num = await addNode(page, /^Number \+$/, "Number");
  await addNode(page, /^Sum \+$/, "SUM");
  await addNode(page, /^Sum \+$/, "SUM");
  const sums = page.locator(".react-flow__node", { hasText: "SUM" });
  await expect(sums).toHaveCount(2);
  // The DOM keeps nodes in insertion order (elevateNodesOnSelect is off), so nth(0) is the middle
  // Sum wired between Number and the downstream Sum.
  const mid = sums.nth(0);
  const down = sums.nth(1);

  await moveNode(page, num, 360, 300);
  await moveNode(page, mid, 640, 320);
  await moveNode(page, down, 940, 340);

  await wire(page, num, "out", mid, "i0");
  await wire(page, mid, "out", down, "i0");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  return { num, mid, down };
}

/** The palette row for a macro definition, clickable to place a fresh instance. */
export function macroPaletteRow(page: Page, name: string): Locator {
  return page.locator('[title="Drag onto the canvas (or click to add)"]', { hasText: name });
}

/** Every placement (instance) of a macro on the canvas, matched by its title. */
export function placements(page: Page, name: string): Locator {
  return page.locator(".react-flow__node", { hasText: name });
}
