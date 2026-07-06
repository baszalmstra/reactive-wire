import { expect, test, type Page } from "@playwright/test";
import { addNumberNode, nodeTransform, resetWorkspace } from "./collab-utils.js";

/**
 * Multi-client collaboration against the mock server's single shared document. Each test drives two
 * browser pages in the same context; edits on one must round-trip through the server's Yjs document
 * and land on the other. Cross-client propagation runs through a local debounce plus a server
 * broadcast, so the "appears on the other page" assertions carry a generous timeout rather than an
 * arbitrary sleep.
 */
test.describe.serial("Reactive Wire collaboration between two clients", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await resetWorkspace(page);
  });

  // Leave the shared document empty so the sibling specs (which rely on the plain clearCanvas
  // helper) never inherit this spec's leftover — in particular the two overlapping nodes the
  // convergence test drops at the same point. Close the extra client pages first so a lingering
  // second client cannot re-flush its stale state back into the doc during cleanup.
  test.afterEach(async ({ page, context }) => {
    for (const other of context.pages()) if (other !== page) await other.close();
    await resetWorkspace(page);
  });

  async function openSecondClient(page: Page, context: import("@playwright/test").BrowserContext): Promise<Page> {
    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByLabel("Home Assistant connected")).toBeVisible();
    // The reset on the primary page must have reached the second client before it edits, so both
    // start from the same empty flow.
    await expect(second.locator(".react-flow__node")).toHaveCount(0, { timeout: 10_000 });
    return second;
  }

  test("mirrors a node added on one page onto the other, at the same position", async ({ page, context }) => {
    const second = await openSecondClient(page, context);

    const { id } = await addNumberNode(page);
    const transformA = await nodeTransform(page, id);

    const nodeB = second.locator(`.react-flow__node[data-id="${id}"]`);
    await expect(nodeB).toBeVisible({ timeout: 10_000 });
    await expect(nodeB).toContainText(/Constant/i);
    // Node wrappers carry the flow-space position as an inline transform, independent of each
    // page's own pan/zoom, so it must match byte for byte across clients.
    await expect.poll(() => nodeTransform(second, id), { timeout: 10_000 }).toBe(transformA);
  });

  test("removes a node from the other page when it is deleted", async ({ page, context }) => {
    const second = await openSecondClient(page, context);

    const { id, node } = await addNumberNode(page);
    const nodeB = second.locator(`.react-flow__node[data-id="${id}"]`);
    await expect(nodeB).toBeVisible({ timeout: 10_000 });

    await node.locator(".rw-drag").click();
    await page.keyboard.press("Delete");
    await expect(node).toHaveCount(0);

    await expect(nodeB).toHaveCount(0, { timeout: 10_000 });
  });

  test("propagates an edited constant value to the other page", async ({ page, context }) => {
    const second = await openSecondClient(page, context);

    const { id } = await addNumberNode(page);
    const inputA = page.locator(`.react-flow__node[data-id="${id}"] input.rw-num`);
    await expect(inputA).toBeVisible();
    await inputA.fill("42");

    const inputB = second.locator(`.react-flow__node[data-id="${id}"] input.rw-num`);
    await expect(inputB).toBeVisible({ timeout: 10_000 });
    await expect(inputB).toHaveValue("42", { timeout: 10_000 });
  });

  test("converges when both pages add a different node at the same time", async ({ page, context }) => {
    const second = await openSecondClient(page, context);

    // Fire both adds without letting either cross-sync in between, so the two clients edit the
    // shared node collection concurrently. Both must end up showing both nodes.
    await Promise.all([
      page.getByRole("button", { name: /Number \+/ }).click(),
      second.getByRole("button", { name: /Number \+/ }).click(),
    ]);

    await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 10_000 });
    await expect(second.locator(".react-flow__node")).toHaveCount(2, { timeout: 10_000 });

    // The two ids differ (each client stamps its own client id into node ids), and both clients
    // must resolve the same pair — proof the concurrent inserts merged rather than clobbered.
    const idsA = await page.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort());
    const idsB = await second.locator(".react-flow__node").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort());
    expect(idsA).toEqual(idsB);
    expect(new Set(idsA).size).toBe(2);
  });
});
