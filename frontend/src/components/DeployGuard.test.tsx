import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Problem } from "../canvas/problems.js";
import { DeployGuard } from "./DeployGuard.js";

afterEach(cleanup);

const hardError: Problem = {
  id: "missing-input",
  severity: "error",
  scope: "structural",
  node: "sink",
  title: "Light",
  message: "Required input is missing.",
};

describe("DeployGuard", () => {
  it("is a labelled modal, initially focuses Cancel, and names its close control", () => {
    const onCancel = vi.fn();
    render(
      <DeployGuard
        open
        problems={[]}
        summary="Review this graph before deployment."
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Deploy to your home" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Review this graph before deployment.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "Close deploy dialog" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps confirmation disabled while hard errors remain", () => {
    render(
      <DeployGuard
        open
        problems={[hardError]}
        summary="Review."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Resolve errors to deploy" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });
});
