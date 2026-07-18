import { expect, test, type Page } from "@playwright/test";
import { addNumberNode, resetWorkspace } from "./collab-utils.js";

/**
 * Workspace surface: the flow tab strip (create / rename / close, and flow-structure persistence
 * across a reload) plus comment frames (create, rename, sync to a second client, survive a reload).
 * Every test starts from and restores a single empty flow so the shared server document does not
 * carry flows or nodes into the next test.
 * Multi-flow content tests cover the React batching regression where creating a flow used to
 * clear the active store before its flow-state updater captured that store.
 */
test.describe.serial("Reactive Wire workspace: flows and comments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await resetWorkspace(page);
  });

  // Leave a single empty flow behind so neither this spec's later tests nor the sibling specs
  // inherit extra flows or leftover nodes. Close any extra client page first so it cannot re-flush
  // stale state into the shared document during cleanup.
  test.afterEach(async ({ page, context }) => {
    for (const other of context.pages()) if (other !== page) await other.close();
    await resetWorkspace(page);
  });

  const newFlow = (page: Page) => page.getByRole("button", { name: "New flow" });
  const closeButtons = (page: Page) => page.locator('button[title="Close flow"]');
  const tab = (page: Page, name: string) => page.locator(`div[title="${name}"]`);

  test("creates a second flow with its own empty canvas", async ({ page }) => {
    await addNumberNode(page);
    await expect(page.locator(".react-flow__node")).toHaveCount(1);

    await newFlow(page).click();
    // A second flow exists (both tabs now carry a close control) and its canvas starts empty rather
    // than inheriting the first flow's node.
    await expect(closeButtons(page)).toHaveCount(2);
    await expect(tab(page, "Flow 2")).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
  });

  test("renames a flow through its tab", async ({ page }) => {
    await tab(page, "Flow 1").dblclick();
    const editor = tab(page, "Flow 1").getByRole("textbox");
    await editor.fill("Kitchen");
    await editor.press("Enter");

    await expect(tab(page, "Kitchen")).toBeVisible();
    await expect(tab(page, "Flow 1")).toHaveCount(0);
    // resetWorkspace normalizes the surviving flow's name back to "Flow 1" for the next test.
  });

  test("closes a flow from its tab", async ({ page }) => {
    await newFlow(page).click();
    await expect(closeButtons(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Close Flow 2" }).click();
    await expect(tab(page, "Flow 2")).toHaveCount(0);
    await expect(closeButtons(page)).toHaveCount(0);
  });

  test("restores the open flows after a reload", async ({ page }) => {
    await newFlow(page).click();
    await expect(closeButtons(page)).toHaveCount(2);

    // Give the debounced local→server flush time to carry both flows into the shared document.
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();

    await expect(closeButtons(page)).toHaveCount(2, { timeout: 10_000 });
    await expect(tab(page, "Flow 1")).toBeVisible();
    await expect(tab(page, "Flow 2")).toBeVisible();
  });

  test("adds a comment frame, renames it, and syncs it to a second page", async ({ page, context }) => {
    await page.getByRole("button", { name: "Comment" }).click();
    const bar = page.locator(".rw-comment-bar");
    await expect(bar).toBeVisible();

    await bar.dblclick();
    const input = page.locator(".rw-comment-input");
    await input.fill("Zone A");
    await input.press("Enter");
    await expect(page.locator(".rw-comment-title")).toHaveText("Zone A");

    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByLabel("Home Assistant connected")).toBeVisible();
    await expect(second.locator(".rw-comment-title")).toHaveText("Zone A", { timeout: 10_000 });
  });

  test("keeps a comment frame across a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Comment" }).click();
    const bar = page.locator(".rw-comment-bar");
    await bar.dblclick();
    const input = page.locator(".rw-comment-input");
    await input.fill("Persisted");
    await input.press("Enter");
    await expect(page.locator(".rw-comment-title")).toHaveText("Persisted");

    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await expect(page.locator(".rw-comment-title")).toHaveText("Persisted", { timeout: 10_000 });
  });

  // Regression: creating the second flow must stash Flow 1 before React clears the live canvas.
  test("preserves each flow's contents when switching tabs", async ({ page }) => {
    const { id: id1 } = await addNumberNode(page);

    await newFlow(page).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    const { id: id2 } = await addNumberNode(page);

    await tab(page, "Flow 1").click();
    await expect(page.locator(`.react-flow__node[data-id="${id1}"]`)).toBeVisible();
    await expect(page.locator(`.react-flow__node[data-id="${id2}"]`)).toHaveCount(0);

    await tab(page, "Flow 2").click();
    await expect(page.locator(`.react-flow__node[data-id="${id2}"]`)).toBeVisible();
    await expect(page.locator(`.react-flow__node[data-id="${id1}"]`)).toHaveCount(0);
  });

  test("persists every flow's nodes across a reload", async ({ page }) => {
    const { id: id1 } = await addNumberNode(page);
    await newFlow(page).click();
    const { id: id2 } = await addNumberNode(page);

    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();

    await tab(page, "Flow 1").click();
    await expect(page.locator(`.react-flow__node[data-id="${id1}"]`)).toBeVisible({ timeout: 10_000 });
    await tab(page, "Flow 2").click();
    await expect(page.locator(`.react-flow__node[data-id="${id2}"]`)).toBeVisible({ timeout: 10_000 });
  });
});
