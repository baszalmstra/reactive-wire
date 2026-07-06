import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";
import { addNode, connect, connectUntilEdge, edges, inPin, moveNodeTo, nodes, outPin, selectWire } from "./wiring-utils.js";

/**
 * Graph-building mechanics against the mock server started by start-app.ts: dragging pin-to-pin
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

  // Adding a node checkpoints the empty canvas before the add, so a single undo returns to empty
  // and redo brings the node back.
  test("undo and redo a node add", async ({ page }) => {
    await addNode(page, "Boolean");
    await expect(nodes(page)).toHaveCount(1);

    await page.keyboard.press("Control+z");
    await expect(nodes(page)).toHaveCount(0);

    await page.keyboard.press("Control+y");
    await expect(nodes(page)).toHaveCount(1);
  });

  // Deleting a node checkpoints the graph before the removal, so a single undo brings back both the
  // node and the wire that connected it regardless of how React batches the delete commit.
  test("undo restores a deleted node together with its wire", async ({ page }) => {
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

    await connectUntilEdge(page, outPin(boolNode, "out"), inPin(notNode, "in"));
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
