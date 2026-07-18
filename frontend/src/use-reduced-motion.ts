import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Tracks the operating-system motion preference for imperative canvas navigation. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.(QUERY).matches ?? false);

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reduced;
}
