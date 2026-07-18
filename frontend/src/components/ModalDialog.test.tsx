import { useId, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModalDialog } from "./ModalDialog.js";

afterEach(cleanup);

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      <ModalDialog open={open} onClose={close} labelledBy={titleId}>
        <div>
          <h2 id={titleId}>Settings</h2>
          <button data-dialog-initial>Cancel</button>
          <button>Save</button>
        </div>
      </ModalDialog>
    </>
  );
}

describe("ModalDialog", () => {
  it("exposes a named modal, moves focus in, closes on Escape, and restores focus", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open settings" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBe(document.activeElement);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toBe(document.activeElement);
  });

  it("contains Tab focus and closes only when the native backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save" });

    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toBe(document.activeElement);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(save).toBe(document.activeElement);

    fireEvent.mouseDown(screen.getByText("Settings"), { clientX: 10, clientY: 10 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog, { clientX: 10, clientY: 10 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
