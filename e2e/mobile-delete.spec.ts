import { expect, test, type Page } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";
import { addNode, connectUntilEdge, edges, inPin, moveNodeTo, nodes, outPin, selectWire } from "./wiring-utils.js";

async function usePhoneLayout(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await expect(page.getByLabel("Home Assistant connected")).toBeAttached();
  await clearCanvas(page);
}

async function addMobileNode(page: Page, label: string) {
  await page.getByRole("button", { name: "Node palette" }).click();
  const node = await addNode(page, label);
  await page.locator(".rw-scrim").click({ position: { x: 300, y: 100 } });
  return node;
}

async function spreadNodesForPhone(page: Page, first: Awaited<ReturnType<typeof addMobileNode>>, second: Awaited<ReturnType<typeof addMobileNode>>): Promise<void> {
  // Keeping the nodes vertically separate leaves both pairs of handles tap-accessible at 320 px.
  await moveNodeTo(page, first, 120, 130);
  await page.getByRole("button", { name: "Inspect" }).click();
  await moveNodeTo(page, second, 120, 330);
  await page.getByRole("button", { name: "Inspect" }).click();
}

test.describe.serial("Mobile delete controls", () => {
  test("deletes a selected node after confirming its affected wire", async ({ page }) => {
    await usePhoneLayout(page);
    const boolNode = await addMobileNode(page, "Boolean");
    const notNode = await addMobileNode(page, "NOT");
    await spreadNodesForPhone(page, boolNode, notNode);

    await connectUntilEdge(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await boolNode.locator(".rw-drag").click();
    await expect(page.getByRole("button", { name: "Delete" })).toBeEnabled();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete selection?" })).toContainText("1 node and 1 wire");
    await expect(page.locator("body")).toHaveAttribute("data-pr-screenshot", "ready");
    await page.getByRole("dialog", { name: "Delete selection?" }).getByRole("button", { name: "Delete" }).click();

    await expect(nodes(page)).toHaveCount(1);
    await expect(edges(page)).toHaveCount(0);
  });

  test("deletes a selected wire after confirmation", async ({ page }) => {
    await usePhoneLayout(page);
    const boolNode = await addMobileNode(page, "Boolean");
    const notNode = await addMobileNode(page, "NOT");
    await spreadNodesForPhone(page, boolNode, notNode);

    await connectUntilEdge(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await selectWire(page, outPin(boolNode, "out"), inPin(notNode, "in"));
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete selection?" })).toContainText("1 wire");
    await page.getByRole("dialog", { name: "Delete selection?" }).getByRole("button", { name: "Delete" }).click();

    await expect(edges(page)).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(2);
  });
});
