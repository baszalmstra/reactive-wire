import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ValueChip } from "./ValueChip.js";

describe("ValueChip contrast", () => {
  it("keeps stale value text opaque and uses a non-color-only border cue", () => {
    const { container } = render(<ValueChip value={{ type: "num", status: "stale", v: 12 }} unit="W" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.className).toContain("border-dashed");
    expect(chip.className).not.toMatch(/opacity-|filter:/);
    expect(chip.textContent).toContain("12");
    const unit = Array.from(chip.querySelectorAll("span")).find((item) => item.textContent === "W");
    expect(unit?.className).toContain("text-rw-faint");
    expect(unit?.className).not.toContain("opacity-");
  });
});
