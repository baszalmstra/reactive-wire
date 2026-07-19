import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeleteSelectionDialog } from "./DeleteSelectionDialog.js";

afterEach(cleanup);

describe("DeleteSelectionDialog", () => {
  it("names every affected graph item and requires an explicit confirmation", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteSelectionDialog open nodeCount={2} edgeCount={3} onCancel={onCancel} onConfirm={onConfirm} />);

    const dialog = screen.getByRole("dialog", { name: "Delete selection?" });
    expect(dialog.textContent).toContain("2 nodes and 3 wires");
    expect(dialog.textContent).toContain("You can undo this action afterwards.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
