import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FlowTabs, flowPanelId, flowTabId } from "./FlowTabs.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flows = [
  { id: "flow/a", name: "Lighting" },
  { id: "flow:b", name: "Climate" },
  { id: "flow-c", name: "Alerts" },
];

function Harness() {
  const [items, setItems] = useState(flows);
  const [active, setActive] = useState(items[0]!.id);
  return (
    <>
      <FlowTabs
        flows={items}
        activeId={active}
        deployedIds={[items[0]!.id]}
        onSelect={setActive}
        onAdd={() => {}}
        onRename={(id, name) => setItems((current) => current.map((flow) => flow.id === id ? { ...flow, name } : flow))}
        onClose={(id) => {
          const index = items.findIndex((flow) => flow.id === id);
          const rest = items.filter((flow) => flow.id !== id);
          setItems(rest);
          if (id === active) setActive(rest[Math.max(0, index - 1)]!.id);
        }}
        onToggleDeploy={() => {}}
      />
      <div role="tabpanel" id={flowPanelId(active)} aria-labelledby={flowTabId(active)}>Canvas</div>
    </>
  );
}

describe("FlowTabs", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("exposes a roving tablist linked to the active canvas panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Flows" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
    expect(tabs[0]!.id).toBe(flowTabId("flow/a"));
    expect(tabs[0]!.getAttribute("aria-controls")).toBe(flowPanelId("flow/a"));
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(flowTabId("flow/a"));
  });

  it("selects and focuses tabs with arrows, Home, and End", () => {
    render(<Harness />);
    const lighting = screen.getByRole("tab", { name: "Lighting" });
    lighting.focus();
    fireEvent.keyDown(lighting, { key: "ArrowRight" });
    const climate = screen.getByRole("tab", { name: "Climate" });
    expect(climate.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(climate);

    fireEvent.keyDown(climate, { key: "End" });
    const alerts = screen.getByRole("tab", { name: "Alerts" });
    expect(alerts.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(alerts);

    fireEvent.keyDown(alerts, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Lighting" }).getAttribute("aria-selected")).toBe("true");
  });

  it("renames with F2 and restores focus after Enter commit and Escape cancel", async () => {
    render(<Harness />);
    const lighting = screen.getByRole("tab", { name: "Lighting" });
    fireEvent.keyDown(lighting, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Rename Lighting" });
    fireEvent.change(editor, { target: { value: "Kitchen" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    const renamed = screen.getByRole("tab", { name: "Kitchen" });
    await waitFor(() => expect(document.activeElement).toBe(renamed));

    const kitchen = screen.getByRole("tab", { name: "Kitchen" });
    fireEvent.keyDown(kitchen, { key: "F2" });
    const cancelEditor = screen.getByRole("textbox", { name: "Rename Kitchen" });
    fireEvent.change(cancelEditor, { target: { value: "Discarded" } });
    fireEvent.keyDown(cancelEditor, { key: "Escape" });
    const restored = screen.getByRole("tab", { name: "Kitchen" });
    await waitFor(() => expect(document.activeElement).toBe(restored));
  });

  it("focuses the selected adjacent tab after closing the active flow", async () => {
    render(<Harness />);
    const climate = screen.getByRole("tab", { name: "Climate" });
    fireEvent.click(climate);
    const close = screen.getByRole("button", { name: "Close Climate" });
    close.focus();
    fireEvent.click(close);

    const lighting = screen.getByRole("tab", { name: "Lighting" });
    await waitFor(() => expect(document.activeElement).toBe(lighting));
    expect(lighting.getAttribute("aria-selected")).toBe("true");
  });
});
