import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V } from "../../../shared/value.js";
import { Sparkline, type Sample } from "./Sparkline.js";

afterEach(() => vi.useRealTimers());

describe("datetime history timezone rendering", () => {
  it("uses the explicit Home Assistant timezone for relative, absolute, and strip labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-06-15T10:00:00Z"));
    const instant = Date.parse("2026-06-16T09:00:00Z");
    const history: Sample[] = [
      { value: V("datetime", instant), t: Date.parse("2026-06-15T09:58:00Z") },
      { value: V("datetime", instant), t: Date.parse("2026-06-15T09:59:00Z") },
    ];

    const { container } = render(<Sparkline history={history} timeZone="Pacific/Kiritimati" />);

    expect(screen.getByText("in 23h")).toBeTruthy();
    expect(screen.getByText(/(?:Jun.*16|16.*Jun).*23:00/)).toBeTruthy();
    expect(container.querySelector("[title*='23:00']")).toBeTruthy();
  });
});
