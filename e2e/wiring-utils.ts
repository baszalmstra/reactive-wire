import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Helpers for driving Reactive Wire's graph-building affordances from Playwright: adding palette
 * nodes, repositioning them so their React Flow handles are unoccluded, dragging pin-to-pin wires,
 * and selecting an edge. Selectors lean on React Flow's stable data attributes (data-id on nodes,
 * data-handleid/source/target on handles) and the app's own rw- classes, never DOM structure.
 */

const canvasNode = ".react-flow__node";
const canvasEdge = ".react-flow__edge";

export function nodes(page: Page): Locator {
  return page.locator(canvasNode);
}

export function edges(page: Page): Locator {
  return page.locator(canvasEdge);
}

/** The data-id of every graph node currently on the canvas, in DOM order. */
async function nodeIds(page: Page): Promise<string[]> {
  return nodes(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id") ?? ""));
}

/**
 * Click a palette entry by its label (e.g. "Boolean", "NOT", "Number") and return a locator pinned
 * to the node that appeared, identified by the data-id that was not present before the click. Pinning
 * by id keeps the locator stable even when a later test adds a second node with the same title.
 */
export async function addNode(page: Page, label: string): Promise<Locator> {
  const before = await nodeIds(page);
  await page.getByRole("button", { name: new RegExp(`^${label} \\+$`) }).click();
  await expect(nodes(page)).toHaveCount(before.length + 1);
  const after = await nodeIds(page);
  const id = after.find((x) => x && !before.includes(x));
  if (!id) throw new Error(`could not identify the newly added "${label}" node`);
  return page.locator(`${canvasNode}[data-id="${id}"]`);
}

/** The source (output, right-side) handle for a pin id on a node. */
export function outPin(node: Locator, pin: string): Locator {
  return node.locator(`.react-flow__handle.source[data-handleid="${pin}"]`);
}

/** The target (input, left-side) handle for a pin id on a node. */
export function inPin(node: Locator, pin: string): Locator {
  return node.locator(`.react-flow__handle.target[data-handleid="${pin}"]`);
}

async function center(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("element has no bounding box (not visible)");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drag a node by its header (.rw-drag drag handle) so its center lands at an absolute screen point.
 * Used to spread freshly-added nodes apart — the palette stacks them with a small offset, which
 * would otherwise leave one node's handles hidden under another.
 */
export async function moveNodeTo(page: Page, node: Locator, x: number, y: number): Promise<void> {
  const from = await center(node.locator(".rw-drag"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

/** Drag a wire from one handle to another by dragging between their centers. */
export async function connect(page: Page, from: Locator, to: Locator): Promise<void> {
  const s = await center(from);
  const t = await center(to);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move((s.x + t.x) / 2, (s.y + t.y) / 2, { steps: 8 });
  await page.mouse.move(t.x, t.y, { steps: 8 });
  await page.mouse.move(t.x, t.y);
  await page.mouse.up();
}

/**
 * Select the wire drawn between two handles by clicking its midpoint. React Flow's default bezier
 * for left/right handles passes exactly through the midpoint of the straight line between the two
 * endpoints, so the average of the handle centers lands on the (focusable) edge path.
 */
export async function selectWire(page: Page, from: Locator, to: Locator): Promise<void> {
  const s = await center(from);
  const t = await center(to);
  await page.mouse.click((s.x + t.x) / 2, (s.y + t.y) / 2);
}
