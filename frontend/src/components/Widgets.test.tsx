import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BoundsModeSelect, PinValueEditor } from "./Widgets.js";

afterEach(cleanup);

describe("bounds mode select", () => {
  it("offers four accessible include/exclude combinations", () => {
    const onChange = vi.fn();
    render(<BoundsModeSelect includeMin includeMax={false} onChange={onChange} />);

    const select = screen.getByRole("combobox", { name: "Bounds mode" });
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Include min, exclude max — [min, max)",
      "Include min and max — [min, max]",
      "Exclude min and max — (min, max)",
      "Exclude min, include max — (min, max]",
    ]);
    fireEvent.change(select, { target: { value: "open-closed" } });
    expect(onChange).toHaveBeenCalledWith({ includeMin: false, includeMax: true });
  });
});

describe("color presets", () => {
  it("names each target and exposes the selected color", () => {
    const onChange = vi.fn();
    render(<PinValueEditor type="color" value="#0a84ff" onChange={onChange} />);

    const blue = screen.getByRole("button", { name: "Set color Blue" });
    const red = screen.getByRole("button", { name: "Set color Red" });
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    expect(red.getAttribute("aria-pressed")).toBe("false");
    expect(blue.className).toContain("w-8");
    fireEvent.click(red);
    expect(onChange).toHaveBeenCalledWith("#ff3b30");
  });
});
