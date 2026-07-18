import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PinValueEditor } from "./Widgets.js";

afterEach(cleanup);

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
