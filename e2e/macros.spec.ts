import { expect, test } from "@playwright/test";
import { clearCanvas } from "./canvas-utils.js";
import {
  buildChain,
  clearMacros,
  macroPaletteRow,
  moveNode,
  placements,
  selectNode,
  setMacroInput,
} from "./macros-utils.js";

/**
 * End-to-end coverage for macros / grouping against the mock server started by start-app.mjs.
 * A macro is built by selecting nodes on the canvas and grouping them: the wires that cross the
 * selection become the macro's typed boundary, and a single placement node replaces the selection
 * while keeping its outer wiring. These specs drive that flow through the real UI — group, edit the
 * definition, place independent instances, and round-trip through the persisted collaborative doc.
 *
 * The mock server's collaborative document is shared and persisted, and macro definitions live in
 * it independently of canvas nodes, so each spec starts from both an empty canvas (clearCanvas) and
 * an empty macro library (clearMacros). With a clean library the auto-generated name is always
 * "Macro 1".
 */
test.describe.serial("Macros and grouping against the mock server", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();
    await clearCanvas(page);
    await clearMacros(page);
  });

  test("groups a wired selection into a placement with derived boundary pins", async ({ page }) => {
    const { mid } = await buildChain(page);

    // Group just the middle node: the wire entering it becomes a macro input, the wire leaving it
    // a macro output.
    await selectNode(page, mid);
    const group = page.getByRole("button", { name: "Group" });
    await expect(group).toBeEnabled();
    await group.click();

    const placement = placements(page, "Macro 1");
    await expect(placement).toHaveCount(1);

    // Exactly one boundary input (in0) and one output (out0), derived from the two crossing wires,
    // labeled after the pins they connect.
    await expect(placement.locator(".react-flow__handle.target")).toHaveCount(1);
    await expect(placement.locator(".react-flow__handle.source")).toHaveCount(1);
    await expect(placement.locator('.react-flow__handle[data-handleid="in0"]')).toHaveCount(1);
    await expect(placement.locator('.react-flow__handle[data-handleid="out0"]')).toHaveCount(1);
    await expect(placement).toContainText("in");
    await expect(placement).toContainText("sum");

    // The outer wires are preserved: the source still feeds the placement, the placement still feeds
    // the downstream Sum — two edges remain.
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
    // The grouped Sum is consumed into the definition; the Number source and downstream Sum remain.
    // (Match the Sum by its "Math" subtitle: hasText is case-insensitive, so a placement's lowercase
    // "sum" output label would otherwise match "SUM" too.)
    await expect(page.locator(".react-flow__node", { hasText: "Math" })).toHaveCount(1);
    await expect(page.locator(".react-flow__node", { hasText: "Number" })).toHaveCount(1);

    // The new macro appears in the palette's Macros list, ready to place again.
    await expect(macroPaletteRow(page, "Macro 1")).toBeVisible();
  });

  test("absorbs an internal wire when several nodes are grouped together", async ({ page }) => {
    const { num, mid } = await buildChain(page);

    // Multi-select the Number source and the middle Sum (Shift adds to the selection), then group.
    // The Number→Sum wire is now wholly inside the selection, so it moves into the definition and
    // yields no boundary input; only the wire leaving to the downstream Sum becomes an output.
    await selectNode(page, num);
    await selectNode(page, mid, { add: true });
    await page.getByRole("button", { name: "Group" }).click();

    const placement = placements(page, "Macro 1");
    await expect(placement).toHaveCount(1);

    // The Number source is absorbed into the macro, gone from the parent canvas.
    await expect(page.locator(".react-flow__node", { hasText: "Number" })).toHaveCount(0);
    // No inputs (the only incoming wire was internal), a single output to the downstream Sum.
    await expect(placement.locator(".react-flow__handle.target")).toHaveCount(0);
    await expect(placement.locator(".react-flow__handle.source")).toHaveCount(1);
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  });

  test("opens the macro editor showing the inner node and boundary nodes", async ({ page }) => {
    const { mid } = await buildChain(page);
    await selectNode(page, mid);
    await page.getByRole("button", { name: "Group" }).click();

    // Double-clicking a placement opens its definition canvas.
    await placements(page, "Macro 1").first().locator(".rw-drag").dblclick();
    const editor = page.locator("div.fixed.inset-0.z-50");
    await expect(editor.getByText("Editing macro")).toBeVisible();

    // The grouped inner Sum lives inside the definition, flanked by the Input / Output boundary nodes.
    // (Match by the "Math" subtitle: the Output boundary's "sum" pin label would match "SUM" too.)
    await expect(editor.locator(".react-flow__node", { hasText: "Math" })).toHaveCount(1);
    // Match the boundary nodes by their unique subtitle ("Macro input" / "Macro output"): the inner
    // Sum's "+ add input" placeholder would match a bare "Input".
    await expect(editor.locator(".react-flow__node", { hasText: "Macro input" })).toBeVisible();
    await expect(editor.locator(".react-flow__node", { hasText: "Macro output" })).toBeVisible();

    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(editor).toHaveCount(0);
  });

  test("reflects a definition edit on the placement", async ({ page }) => {
    const { mid } = await buildChain(page);
    await selectNode(page, mid);
    await page.getByRole("button", { name: "Group" }).click();

    const placement = placements(page, "Macro 1");
    await expect(placement.locator(".react-flow__handle.source")).toHaveCount(1);

    // Edit the definition: add an output pin to its interface and rename it.
    await placement.first().locator(".rw-drag").dblclick();
    const editor = page.locator("div.fixed.inset-0.z-50");
    await expect(editor.getByText("Editing macro")).toBeVisible();
    await editor.getByRole("button", { name: "+ add output" }).click();
    await editor.locator('input[placeholder="Macro name"]').fill("Doubler");
    await editor.getByRole("button", { name: "Save macro" }).click();
    await expect(editor).toHaveCount(0);

    // The placement follows the edited definition: renamed, and now carrying a second output pin.
    const renamed = placements(page, "Doubler");
    await expect(renamed).toHaveCount(1);
    await expect(renamed.locator(".react-flow__handle.source")).toHaveCount(2);
  });

  test("evaluates two placements of the same macro independently", async ({ page }) => {
    const { mid } = await buildChain(page);
    await selectNode(page, mid);
    await page.getByRole("button", { name: "Group" }).click();
    await expect(placements(page, "Macro 1")).toHaveCount(1);

    // Keep the macro definition but clear the canvas, then place two fresh instances. Each macro
    // input is editable, so a placement can supply its own literal — the macro passes the input
    // through to its output (a single-input Sum), giving two independent results.
    await clearCanvas(page);

    await macroPaletteRow(page, "Macro 1").click();
    const first = placements(page, "Macro 1").last();
    await moveNode(page, first, 480, 300);
    await setMacroInput(first, "3");

    await macroPaletteRow(page, "Macro 1").click();
    const second = placements(page, "Macro 1").last();
    await moveNode(page, second, 480, 520);
    await setMacroInput(second, "8");

    // Two placements, two distinct outputs — the instances do not share state.
    const all = placements(page, "Macro 1");
    await expect(all).toHaveCount(2);
    await expect(all.filter({ hasText: "3" })).toHaveCount(1);
    await expect(all.filter({ hasText: "8" })).toHaveCount(1);
  });

  test("round-trips a macro definition and placement through a page reload", async ({ page }) => {
    const { mid } = await buildChain(page);
    await selectNode(page, mid);
    await page.getByRole("button", { name: "Group" }).click();
    await expect(placements(page, "Macro 1")).toHaveCount(1);

    // Let the debounced document flush reach the server, then reload from the persisted doc.
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.getByLabel("Home Assistant connected")).toBeVisible();

    // Both the definition (palette) and the placement (canvas, with its boundary pins) survived.
    await expect(macroPaletteRow(page, "Macro 1")).toBeVisible();
    const placement = placements(page, "Macro 1");
    await expect(placement).toHaveCount(1);
    await expect(placement.locator(".react-flow__handle.target")).toHaveCount(1);
    await expect(placement.locator(".react-flow__handle.source")).toHaveCount(1);
  });

  test("removes a macro from the library via the palette", async ({ page }) => {
    const { mid } = await buildChain(page);
    await selectNode(page, mid);
    // Gate on the selection registering: Group only enables once a node is selected, so clicking it
    // before the header click commits would be a no-op and leave the library empty.
    const group = page.getByRole("button", { name: "Group" });
    await expect(group).toBeEnabled();
    await group.click();
    await expect(macroPaletteRow(page, "Macro 1")).toBeVisible();

    await page.locator('button[title="Delete macro"]').click();
    await expect(macroPaletteRow(page, "Macro 1")).toHaveCount(0);
    await expect(page.getByText(/Select nodes and choose/)).toBeVisible();
  });

  // No ungroup / dissolve affordance exists: a placement can be deleted or its definition removed,
  // but there is no UI to explode a placement back into its constituent nodes on the parent canvas.
  // Documented here so the gap is visible in the runner; unskip when the affordance lands.
  test.skip("ungroups a placement back into its nodes (no affordance yet)", () => {});
});
