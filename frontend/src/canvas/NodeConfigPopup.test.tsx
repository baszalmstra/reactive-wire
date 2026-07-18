import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NodeConfigPopup } from "./NodeConfigPopup.js";

afterEach(cleanup);

describe("NodeConfigPopup", () => {
  it("opens as a named dialog, focuses the entity field, and closes on Escape", () => {
    const onCancel = vi.fn();
    render(
      <NodeConfigPopup
        requires={{ field: "entity_id", kind: "entity", label: "Target entity" }}
        entities={{}}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Choose target entity" })).toBeTruthy();
    const input = screen.getByPlaceholderText("domain.entity");
    expect(input).toBe(document.activeElement);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
