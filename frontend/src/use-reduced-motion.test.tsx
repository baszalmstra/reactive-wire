import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useReducedMotion } from "./use-reduced-motion.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useReducedMotion", () => {
  it("tracks changes to the operating-system preference", () => {
    let matches = false;
    let listener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return matches; },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_: string, cb: () => void) => { listener = cb; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listener?.();
    });
    expect(result.current).toBe(true);
  });
});
