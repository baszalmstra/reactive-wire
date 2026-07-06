import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";
import { addNode, connect, edges, inPin, moveNodeTo, nodes, outPin, selectWire } from "./wiring-utils.js";

/**
 * Graph-building mechanics against the mock server started by start-app.mjs: dragging pin-to-pin
 * wires, connection validation (type mismatch + cycle rejection), deleting wires and nodes, and
 * undo/redo. The editor evaluates the graph live, so a downstream node's value chip is the observable
 * signal that a wire took effect. The mock server's collaborative document is shared and persisted,
 * so each test starts from an empty canvas via clearCanvas.
 */
test.describe.serial("Graph building against the mock server", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await clearCanvas(page);
  });

  // Spread positions: source node on the left, sink node lower-right, so their handles never overlap.
  const LEFT = { x: 430, y: 300 };
  const RIGHT = { x: 760, y: 430 };

  test("wires a boolean source into a NOT node and the downstream preview updates", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    // Unconnected, the NOT node has no input and reads unavailable.
    await expect(notNode).toContainText("unavailable");

    await connect(page, outPin(boolNode, "out"), inPin(notNode, "in"));

    // The edge exists and the live evaluation flows: Boolean defaults to false, NOT inverts it to true.
    await expect(edges(page)).toHaveCount(1);
    await expect(notNode).toContainText("true");
    await expect(notNode).not.toContainText("unavailable");
  });

  test("wiring a false source into an AND flips its output chip", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const andNode = await addNode(page, "AND");
    await moveNodeTo(page, andNode, RIGHT.x, RIGHT.y);

    // With nothing wired an AND is the identity (true); "false" appears only in the value chip.
    await expect(andNode).not.toContainText("false");

    await connect(page, outPin(boolNode, "out"), inPin(andNode, "i0"));

    await expect(edges(page)).toHaveCount(1);
    await expect(andNode).toContainText("false");
  });

  test("rejects a type-mismatched connection (number output into a boolean input)", async ({ page }) => {
    const numNode = await addNode(page, "Number");
    await moveNodeTo(page, numNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    await connect(page, outPin(numNode, "out"), inPin(notNode, "in"));

    // The drag is refused: a toast explains why and no edge is created.
    await expect(page.getByText(/Type mismatch/)).toBeVisible();
    await expect(edges(page)).toHaveCount(0);
  });

  test("rejects a connection that would create a cycle", async ({ page }) => {
    const first = await addNode(page, "NOT");
    await moveNodeTo(page, first, LEFT.x, LEFT.y);
    const second = await addNode(page, "NOT");
    await moveNodeTo(page, second, RIGHT.x, RIGHT.y);

    await connect(page, outPin(first, "out"), inPin(second, "in"));
    await expect(edges(page)).toHaveCount(1);

    // Closing the loop (second -> first) would make values flow in a cycle; the DAG rule refuses it.
    await connect(page, outPin(second, "out"), inPin(first, "in"));
    await expect(page.getByText(/cycle/i)).toBeVisible();
    await expect(edges(page)).toHaveCount(1);
  });

  test("deleting a wire returns the downstream node to unavailable", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    await connect(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await expect(edges(page)).toHaveCount(1);
    await expect(notNode).toContainText("true");

    await selectWire(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
    await page.keyboard.press("Delete");

    await expect(edges(page)).toHaveCount(0);
    await expect(notNode).toContainText("unavailable");
  });

  test("deleting a node removes its wires too", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    await connect(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await expect(edges(page)).toHaveCount(1);

    await boolNode.locator(".rw-drag").click();
    await page.keyboard.press("Delete");

    // The source node and its dangling wire are gone; the orphaned NOT reads unavailable again.
    await expect(nodes(page)).toHaveCount(1);
    await expect(edges(page)).toHaveCount(0);
    await expect(notNode).toContainText("unavailable");
  });

  // KNOWN APP BUG — undo does not remove a freshly added node. Adding a node checkpoints history,
  // but pushHistory (frontend/src/state/use-undo-redo.ts) builds its snapshot lazily inside the
  // setPast updater, reading nodesRef.current — which App.tsx has already reassigned to the
  // post-add array by the time React runs the updater. So the "before" checkpoint captures the
  // after-state, and Ctrl+Z restores a canvas that still contains the node (and disables Undo,
  // its one checkpoint spent). Undo of a node DELETE works, because React Flow applies the removal
  // in a later commit than onBeforeDelete's pushHistory. This test asserts the intended behavior
  // and is marked fixme until the checkpoint is captured before the mutation.
  test.fixme("undo and redo a node add", async ({ page }) => {
    await addNode(page, "Boolean");
    await expect(nodes(page)).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(nodes(page)).toHaveCount(0);

    await page.keyboard.press("Control+y");
    await expect(nodes(page)).toHaveCount(1);
  });

  // KNOWN APP BUG (same root cause as "undo and redo a node add" above) — undoing a node deletion
  // intermittently fails to bring the node and its wire back, leaving the already-deleted graph in
  // place. The checkpoint is still on the stack (the Undo control stays enabled) but it captured the
  // POST-delete graph, so undo restores nothing. It reproduces mid-suite (~1 in 3 runs) but never in
  // isolation: a fresh server document leaves clearCanvas with nothing to delete, so the delete
  // commit is uncontended and pushHistory happens to snapshot the pre-delete graph; under the busier
  // mid-suite React commit the removal folds into the same commit as the checkpoint. This test
  // asserts the intended behavior and is marked fixme until pushHistory captures its snapshot before
  // the mutation rather than lazily during the following render.
  test.fixme("undo restores a deleted node together with its wire", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    await connect(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await expect(edges(page)).toHaveCount(1);

    await boolNode.locator(".rw-drag").click();
    await page.keyboard.press("Delete");
    await expect(nodes(page)).toHaveCount(1);
    await expect(edges(page)).toHaveCount(0);

    // A single undo should bring back both the node and the wire that connected it.
    await page.keyboard.press("Control+z");
    await expect(nodes(page)).toHaveCount(2);
    await expect(edges(page)).toHaveCount(1);
    await expect(notNode).toContainText("true");
  });

  test("undo and redo survive a wire operation", async ({ page }) => {
    const boolNode = await addNode(page, "Boolean");
    await moveNodeTo(page, boolNode, LEFT.x, LEFT.y);
    const notNode = await addNode(page, "NOT");
    await moveNodeTo(page, notNode, RIGHT.x, RIGHT.y);

    await connect(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await expect(edges(page)).toHaveCount(1);
    await expect(notNode).toContainText("true");

    // Undo removes the wire (nodes stay put); redo restores it and the live value returns.
    await page.keyboard.press("Control+z");
    await expect(edges(page)).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(2);
    await expect(notNode).toContainText("unavailable");

    await page.keyboard.press("Control+y");
    await expect(edges(page)).toHaveCount(1);
    await expect(notNode).toContainText("true");
  });
});
