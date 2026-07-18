import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill.js";
import { Toast } from "./Toast.js";

afterEach(cleanup);

describe("live announcements", () => {
  it("announces errors assertively and information politely", () => {
    const { rerender } = render(<Toast toast={{ id: 1, kind: "error", text: "Deploy failed" }} />);
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
    rerender(<Toast toast={{ id: 2, kind: "info", text: "Saved" }} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("announces deployment status changes atomically", () => {
    render(<StatusPill kind="live" sub="in sync" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("LIVE");
  });
});
