import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";

/**
 * Single-source inputs: a new wire into an already-wired input replaces the old one as one edit
 * (one undo step), and while a connection is dragged onto an occupied input the wire it will
 * replace renders as doomed. Runs against the mock server started by start-app.mjs; the shared
 * collaborative document persists between specs, so each test starts from an empty canvas.
 *
 * The pin-dragging helpers below are copied (not imported) from the wiring-utils used by the
 * sibling wiring spec, so the two specs can evolve independently.
 */

const canvasNode = ".react-flow__node";
const canvasEdge = ".react-flow__edge";

function nodes(page: Page): Locator {
  return page.locator(canvasNode);
}
function edges(page: Page): Locator {
  return page.locator(canvasEdge);
}

async function nodeDomIds(page: Page): Promise<string[]> {
  return nodes(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id") ?? ""));
}

/** Click a palette entry by label and return a locator pinned to the node id that just appeared. */
async function addNode(page: Page, label: string): Promise<Locator> {
  const before = await nodeDomIds(page);
  await page.getByRole("button", { name: new RegExp(`^${label} \\+$`) }).click();
  await expect(nodes(page)).toHaveCount(before.length + 1);
  const after = await nodeDomIds(page);
  const id = after.find((x) => x && !before.includes(x));
  if (!id) throw new Error(`could not identify the newly added "${label}" node`);
  return page.locator(`${canvasNode}[data-id="${id}"]`);
}

const nodeId = (node: Locator): Promise<string> =>
  node.getAttribute("data-id").then((id) => {
    if (!id) throw new Error("node has no data-id");
    return id;
  });

function outPin(node: Locator, pin: string): Locator {
  return node.locator(`.react-flow__handle.source[data-handleid="${pin}"]`);
}
function inPin(node: Locator, pin: string): Locator {
  return node.locator(`.react-flow__handle.target[data-handleid="${pin}"]`);
}

async function center(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("element has no bounding box (not visible)");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a node by its header so its center lands at an absolute screen point (spreads handles apart). */
async function moveNodeTo(page: Page, node: Locator, x: number, y: number): Promise<void> {
  const from = await center(node.locator(".rw-drag"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

/** Drag a wire from one handle to another by dragging between their centers. */
async function connect(page: Page, from: Locator, to: Locator): Promise<void> {
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
 * Drag a wire and retry the drag until `settled` passes — the pin-to-pin drag is occasionally
 * dropped before React Flow registers the handle, and a replace leaves the edge count unchanged so
 * count alone cannot confirm it. `settled` asserts the post-condition (an edge count, or which wire
 * now feeds the input).
 */
async function connectUntil(page: Page, from: Locator, to: Locator, settled: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await connect(page, from, to);
    try {
      await settled();
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await page.waitForTimeout(150);
    }
  }
}

/** The edge locator for a specific source -> target wire, via React Flow's stable aria-label. */
function wire(page: Page, source: string, target: string): Locator {
  return page.locator(`${canvasEdge}[aria-label="Edge from ${source} to ${target}"]`);
}

test.describe.serial("Single-source inputs against the mock server", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await clearCanvas(page);
  });

  // Spread positions so no node's handles hide under another.
  const A = { x: 420, y: 250 };
  const B = { x: 420, y: 470 };
  const C = { x: 780, y: 360 };

  test("a second wire into an occupied input replaces the first, and one undo restores it", async ({ page }) => {
    const boolA = await addNode(page, "Boolean");
    await moveNodeTo(page, boolA, A.x, A.y);
    const boolB = await addNode(page, "Boolean");
    await moveNodeTo(page, boolB, B.x, B.y);
    const notC = await addNode(page, "NOT");
    await moveNodeTo(page, notC, C.x, C.y);

    const aId = await nodeId(boolA);
    const bId = await nodeId(boolB);
    const cId = await nodeId(notC);

    // First wire: A -> C:in.
    await connectUntil(page, outPin(boolA, "out"), inPin(notC, "in"), async () => {
      await expect(edges(page)).toHaveCount(1);
    });
    await expect(wire(page, aId, cId)).toHaveCount(1);

    // Second wire into the same input replaces the first: still exactly one edge, now from B.
    await connectUntil(page, outPin(boolB, "out"), inPin(notC, "in"), async () => {
      await expect(wire(page, bId, cId)).toHaveCount(1);
    });
    await expect(edges(page)).toHaveCount(1);
    await expect(wire(page, aId, cId)).toHaveCount(0);

    // One undo restores the whole replace in a single step: A -> C back, B -> C gone.
    await page.keyboard.press("Control+z");
    await expect(edges(page)).toHaveCount(1);
    await expect(wire(page, aId, cId)).toHaveCount(1);
    await expect(wire(page, bId, cId)).toHaveCount(0);

    // Redo re-applies the whole replace in one step: B -> C back, A -> C gone.
    await page.keyboard.press("Control+y");
    await expect(edges(page)).toHaveCount(1);
    await expect(wire(page, bId, cId)).toHaveCount(1);
    await expect(wire(page, aId, cId)).toHaveCount(0);
  });

  test("the wire under a hovered occupied input renders doomed only during the drag", async ({ page }) => {
    const boolA = await addNode(page, "Boolean");
    await moveNodeTo(page, boolA, A.x, A.y);
    const boolB = await addNode(page, "Boolean");
    await moveNodeTo(page, boolB, B.x, B.y);
    const notC = await addNode(page, "NOT");
    await moveNodeTo(page, notC, C.x, C.y);

    const aId = await nodeId(boolA);
    const cId = await nodeId(notC);

    await connectUntil(page, outPin(boolA, "out"), inPin(notC, "in"), async () => {
      await expect(edges(page)).toHaveCount(1);
    });

    const doomed = page.locator(".rw-edge-main.doomed");
    // Nothing is doomed while idle.
    await expect(doomed).toHaveCount(0);

    // Begin dragging a new wire from B and hover the occupied input on C.
    const src = await center(outPin(boolB, "out"));
    const dst = await center(inPin(notC, "in"));
    await page.mouse.move(src.x, src.y);
    await page.mouse.down();
    await page.mouse.move((src.x + dst.x) / 2, (src.y + dst.y) / 2, { steps: 8 });
    await page.mouse.move(dst.x, dst.y, { steps: 8 });
    await page.mouse.move(dst.x, dst.y);

    // The existing A -> C wire signals it is about to be replaced.
    await expect(doomed).toHaveCount(1);

    // Cancel the drag: leave the handle (feedback must clear), press Escape, and release over empty
    // canvas so no wire is created.
    await page.mouse.move(dst.x - 260, dst.y - 160, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Feedback is gone and the original wire is untouched — no lingering doomed class after the drag.
    await expect(doomed).toHaveCount(0);
    await expect(edges(page)).toHaveCount(1);
    await expect(wire(page, aId, cId)).toHaveCount(1);
  });
});
