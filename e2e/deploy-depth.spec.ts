import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";
import { debugState, nodeOfType, onlySink, queryServer, stateToBool } from "./deploy-depth-utils.js";

/**
 * Depth coverage for the deploy/actuation path, beyond the existing smoke test that only proves a
 * deployResult reaches the UI for an unwired graph. These specs deploy a graph that actually
 * actuates (a reconciling Light sink driving light.bedroom) and then assert against the SERVER's
 * own debugState introspection over a direct WebSocket — proving the editor → server → runtime path
 * end to end, not just that the editor rendered a result.
 *
 * Wiring mechanics (pin-drag) are owned by a sibling spec; per the task's latitude to keep wiring
 * minimal, the actuating graph here sets the Light sink's editable `on` command input to an explicit
 * off rather than dragging a wire. light.bedroom is seeded "on" by the simulator and the MockHA
 * records service calls without mutating state, so the sink deterministically and stably wants to
 * turn it off — a fixed target for the cross-layer assertions.
 */

const PORT = Number(process.env.E2E_RW_PORT ?? 7421);

async function addEntity(page: Page, entityId: string): Promise<void> {
  await page.getByRole("button", { name: /^Entity \+$/ }).click();
  await expect(page.getByText("Choose entity", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(entityId.replace(/\./g, "\\.")) }).click();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Choose entity", { exact: true })).toHaveCount(0);
  await expect(page.locator(".react-flow__node", { hasText: entityId }).last()).toBeVisible();
}

async function addLightSink(page: Page, lightId: string): Promise<Locator> {
  await page.getByRole("button", { name: /^Light \+$/ }).click();
  await expect(page.getByText("Choose light entity", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(lightId.replace(/\./g, "\\.")) }).click();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Choose light entity", { exact: true })).toHaveCount(0);
  // The sink node shows its template subtitle, not the entity id, so match on that.
  const sink = page.locator(".react-flow__node", { hasText: "reconciling sink" }).last();
  await expect(sink).toBeVisible();
  return sink;
}

/** Set a reconciling light sink's `on` command to an explicit boolean via its inline pin toggle. */
async function setSinkOn(sink: Locator, on: boolean): Promise<void> {
  await sink.getByRole("button", { name: on ? "on" : "off", exact: true }).click();
}

/** Push the current graph through the deploy guard and wait for the UI to flip to LIVE. */
async function deployViaGuard(page: Page): Promise<void> {
  await page.locator("button.rw-deploy").click();
  const guard = page.locator("div.fixed.inset-0.z-50");
  await expect(guard.getByText("Deploy to your home")).toBeVisible();
  // The confirm button's label is "Deploy" for a clean graph or "Deploy anyway" when soft warnings
  // are present (a blocked graph would read "Resolve errors to deploy" and is excluded here).
  const confirm = guard.getByRole("button", { name: /^Deploy( anyway)?$/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".rw-deploy-group")).toContainText("LIVE");
}

test.describe.serial("Deploy depth: cross-layer against server debugState", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    // The mock server's collaborative document is shared and persisted, so start each test clean.
    await clearCanvas(page);
  });

  test.afterEach(async ({ page }) => {
    // Auto-deploy is a server-owned, persisted setting; never leak an enabled state into sibling
    // specs (it would change their status pill and trigger unexpected redeploys).
    const checkbox = page.locator(".rw-autodeploy input");
    if (await checkbox.isChecked().catch(() => false)) {
      await page.locator(".rw-autodeploy").click();
      await expect(checkbox).not.toBeChecked();
      await expect.poll(async () => (await debugState(PORT)).autoDeploy, { timeout: 8000 }).toBe(false);
    }
  });

  test("deploys an actuating graph and the server runtime reflects it end to end", async ({ page }) => {
    await addEntity(page, "binary_sensor.room_presence");
    const lightSink = await addLightSink(page, "light.bedroom");

    // An unset command input is unavailable, so the reconciling sink would make no call. Set the `on`
    // command to an explicit off so it wants a concrete turn_off against the (seeded on) light.
    await setSinkOn(lightSink, false);

    const deployGroup = page.locator(".rw-deploy-group");
    await expect(deployGroup).toContainText("DRAFT");
    await deployViaGuard(page);
    await expect(page.locator(".rw-deploy-note")).toHaveText(/deployed/);

    // The runtime evaluates asynchronously after the deploy lands, so its first debugState frame can
    // arrive before the sink's desired call is computed. Wait until the runtime has settled — deployed
    // with the sink wanting a concrete call — before snapshotting, so a pre-first-tick null isn't read
    // as a failure. The target is stable (light seeded on, command set off), so the snapshot taken
    // right after still carries it.
    await expect
      .poll(
        async () => {
          const d = await debugState(PORT);
          return d.deployed && onlySink(d)?.desired != null;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    // Cross-layer: ask the server directly what it deployed and what its runtime is doing.
    const { debug } = await queryServer(PORT);
    expect(debug.deployed).toBe(true);
    expect(debug.mode).toBe("live");
    expect(debug.generation).toBeGreaterThanOrEqual(1);

    // The entity source node evaluated its state output to a concrete boolean, live from the feed.
    // (Its overall health is "warn", not "ok", only because the MockHA never populates the
    // last_changed/last_updated timestamps, so that datetime output reads unavailable — a mock
    // limitation, not a node fault. The load-bearing signal is the resolved state output.)
    const entityNode = nodeOfType(debug, "entity");
    expect(entityNode, "an entity node should be present in the server's deployed graph").toBeDefined();
    expect(entityNode!.health).not.toBe("error");
    const stateOut = entityNode!.outputs.state;
    expect(stateOut, "the entity node should expose a resolved state output").toBeDefined();
    expect(stateOut.status).toBe("ok");
    expect(stateOut.type).toBe("bool");
    expect(typeof stateOut.value).toBe("boolean");

    // The reconciling Light sink wants to turn light.bedroom off (its command was set off while the
    // light is on) — a real desired ServiceCall. Its health is not in error; the optional
    // color/brightness inputs are simply unset.
    const sinkNode = nodeOfType(debug, "sink-light");
    expect(sinkNode, "a sink-light node should be present in the server's deployed graph").toBeDefined();
    expect(sinkNode!.health).not.toBe("error");
    const sink = onlySink(debug);
    expect(sink, "exactly one sink should be deployed").toBeDefined();
    expect(sink!.desired, "the sink should want a concrete service call").not.toBeNull();
    expect(sink!.desired!.domain).toBe("light");
    expect(sink!.desired!.service).toBe("turn_off");
    expect(sink!.desired!.target?.entity_id).toBe("light.bedroom");
  });

  test("the runtime's entity output stays consistent with the server's live feed", async ({ page }) => {
    await addEntity(page, "binary_sensor.room_presence");
    await addLightSink(page, "light.bedroom");
    await deployViaGuard(page);

    // Cross-layer invariant: whatever value the server's live feed reports for the sensor is exactly
    // what its runtime resolved for the entity node's state output. We do not force a flip — the
    // simulator only flips binary_sensor.room_presence on a ~70s cycle (sin(phase*0.37) crosses -0.5
    // with phase advancing 0.06 every 250ms), too slow to wait on. Each iteration is an independent
    // feed-vs-runtime equality check; repeating over ~1.2s spans several 250ms feed ticks, so a
    // runtime that stopped tracking a changing feed would be caught by a later sample.
    for (let i = 0; i < 3; i++) {
      const { debug, entities } = await queryServer(PORT);
      const feed = entities["binary_sensor.room_presence"];
      expect(feed, "the server should report the sensor in its live feed").toBeDefined();
      const entityNode = nodeOfType(debug, "entity");
      expect(entityNode?.outputs.state?.status).toBe("ok");
      expect(entityNode!.outputs.state.value).toBe(stateToBool(feed.state));
      await page.waitForTimeout(400);
    }
  });

  test("cancelling the deploy guard deploys nothing (generation unchanged)", async ({ page }) => {
    await addLightSink(page, "light.bedroom");

    // Baseline the server's generation, then open the guard and back out.
    const before = (await debugState(PORT)).generation;
    await page.locator("button.rw-deploy").click();
    const guard = page.locator("div.fixed.inset-0.z-50");
    await expect(guard.getByText("Deploy to your home")).toBeVisible();
    await guard.getByRole("button", { name: "Cancel" }).click();
    await expect(guard).toHaveCount(0);

    // The editor never flips to LIVE and the server never ran a new deploy.
    await expect(page.locator(".rw-deploy-group")).not.toContainText("LIVE");
    // Give any (non-existent) deploy a chance to land before asserting the generation held steady.
    await page.waitForTimeout(500);
    expect((await debugState(PORT)).generation).toBe(before);
  });

  test("the deploy guard surfaces graph problems before deploying", async ({ page }) => {
    // An entity pointed at a missing entity produces an unavailable-output warning (soft problem).
    await page.getByRole("button", { name: /^Entity \+$/ }).click();
    await page.locator('input[placeholder="domain.entity"]').last().fill("binary_sensor.definitely_missing");
    await page.getByRole("button", { name: "Add" }).click();

    await page.locator("button.rw-deploy").click();
    const guard = page.locator("div.fixed.inset-0.z-50");
    await expect(guard.getByText("Deploy to your home")).toBeVisible();

    // The guard names the warning, explains warnings deploy as-is, and offers "Deploy anyway"
    // (a soft warning does not block the deploy — that button stays enabled).
    await expect(guard.getByText(/degraded inputs will deploy as-is/)).toBeVisible();
    await expect(guard.getByText("Output 'state' is unavailable.")).toBeVisible();
    const confirm = guard.getByRole("button", { name: "Deploy anyway" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();

    // Back out without deploying this problematic graph.
    await guard.getByRole("button", { name: "Cancel" }).click();
    await expect(guard).toHaveCount(0);
  });

  test("auto-deploy redeploys on edit without pressing Deploy (generation bumps)", async ({ page }) => {
    // Build a deployable graph first, then hand control to the server-owned auto-deploy setting.
    await addLightSink(page, "light.bedroom");
    await page.waitForTimeout(400); // let the sink reach the shared document before enabling auto-deploy

    const checkbox = page.locator(".rw-autodeploy input");
    await page.locator(".rw-autodeploy").click();
    await expect(checkbox).toBeChecked();

    // Enabling auto-deploy makes the server deploy the current graph. Wait for that to settle, then
    // baseline the generation.
    await expect.poll(async () => (await debugState(PORT)).autoDeploy, { timeout: 8000 }).toBe(true);
    await expect.poll(async () => (await debugState(PORT)).deployed, { timeout: 8000 }).toBe(true);
    const baseline = (await debugState(PORT)).generation;

    // Edit the graph — add a source node — without touching the Deploy button.
    await addEntity(page, "binary_sensor.room_presence");

    // The server redeploys on its own; its generation advances past the baseline.
    await expect.poll(async () => (await debugState(PORT)).generation, { timeout: 10000 }).toBeGreaterThan(baseline);

    // The redeployed graph really contains the newly added entity node (server-side, not just UI).
    const debug = await debugState(PORT);
    expect(nodeOfType(debug, "entity"), "the auto-redeployed graph should include the new entity node").toBeDefined();
    expect(debug.mode).toBe("live");

    // afterEach turns auto-deploy back off so it cannot leak into sibling specs.
  });

  test("the toolbar exposes no stop/undeploy control (documents its absence)", async ({ page }) => {
    // App.tsx offers Deploy (and auto-deploy) but no affordance to stop or undeploy a running graph;
    // the runtime keeps the last deployed graph until a new deploy replaces it. This test records
    // that intended state so a future Stop/undeploy control is added with its own coverage.
    await expect(page.locator("button.rw-deploy")).toBeVisible();
    await expect(page.getByRole("button", { name: /^stop$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /undeploy/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /stop deploy/i })).toHaveCount(0);
  });
});
