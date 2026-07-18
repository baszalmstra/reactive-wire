import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSimulatedEntities } from "./use-simulated-entities.js";

describe("useSimulatedEntities", () => {
  afterEach(() => vi.useRealTimers());

  it("updates only before a server is seen and never restarts after disconnect", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSimulatedEntities(enabled),
      { initialProps: { enabled: true } },
    );
    const initial = result.current;
    act(() => vi.advanceTimersByTime(90));
    expect(result.current).not.toBe(initial);

    rerender({ enabled: false });
    const retired = result.current;
    act(() => vi.advanceTimersByTime(900));
    expect(result.current).toBe(retired);

    rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(900));
    expect(result.current).toBe(retired);
  });
});
