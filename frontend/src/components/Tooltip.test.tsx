import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip.js";

afterEach(cleanup);

describe("Tooltip", () => {
  it("describes its trigger and opens from focus until blur or Escape", () => {
    const onFocus = vi.fn();
    render(<Tooltip content="Create a node"><button onFocus={onFocus}>Add</button></Tooltip>);
    const trigger = screen.getByRole("button", { name: "Add" });

    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-describedby")).toContain(tooltip.id);

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("composes pointer handlers instead of replacing them", () => {
    const onMouseEnter = vi.fn();
    render(<Tooltip content="Hint"><button onMouseEnter={onMouseEnter}>Hover</button></Tooltip>);
    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger);
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(screen.getByRole("tooltip").textContent).toBe("Hint");
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
