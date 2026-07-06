import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";

/**
 * Exercises the deploy path end to end against the mock server started by start-app.mjs: build a
 * graph from the palette (a live entity plus a reconciling light sink), push it through the deploy
 * guard, and prove the server's deployResult surfaces back in the editor UI. The mock server binds
 * to loopback and accepts deploys without a token (connection-policy), so no token wiring is needed.
 */
test.describe.serial("Deploy path against the mock server", () => {
  // The collaborative document is shared and persisted on the single mock server, so start each
  // test from an empty canvas regardless of what a previous spec left behind or where it failed.
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await clearCanvas(page);
  });

  test("builds a graph, deploys it, and surfaces the server result as LIVE", async ({ page }) => {
    // A live entity node: the state chip proves the server's simulated feed is flowing into the UI.
    await page.getByRole("button", { name: /^Entity \+$/ }).click();
    await expect(page.getByText("Choose entity", { exact: true })).toBeVisible();
    await page.getByRole("option", { name: /binary_sensor\.room_presence/ }).click();
    await page.getByRole("button", { name: "Add" }).click();
    const entityNode = page.locator(".react-flow__node", { hasText: "binary_sensor.room_presence" }).last();
    await expect(entityNode).toBeVisible();

    // A reconciling light sink pointed at a real mock entity — an actuator to deploy.
    await page.getByRole("button", { name: /^Light \+$/ }).click();
    await expect(page.getByText("Choose light entity", { exact: true })).toBeVisible();
    await page.getByRole("option", { name: /light\.bedroom/ }).click();
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Choose light entity", { exact: true })).toHaveCount(0);

    // Before deploying, the editor reports the graph as an undeployed draft.
    const deployGroup = page.locator(".rw-deploy-group");
    await expect(deployGroup).toContainText("DRAFT");

    // Open the deploy guard from the toolbar and confirm.
    await page.locator("button.rw-deploy").click();
    const guard = page.locator("div.fixed.inset-0.z-50");
    await expect(guard.getByText("Deploy to your home")).toBeVisible();
    const confirm = guard.getByRole("button").last();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The server accepts the deploy and broadcasts a deployResult; the UI flips to LIVE and the
    // toolbar note reports the successful deploy.
    await expect(deployGroup).toContainText("LIVE");
    await expect(page.locator(".rw-deploy-note")).toHaveText(/deployed/);
    await expect(deployGroup).not.toContainText("DRAFT");
  });
});
