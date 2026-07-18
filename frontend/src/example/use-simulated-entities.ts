import { useEffect, useRef, useState } from "react";
import type { EntityMap } from "../../../shared/entities.js";
import { simulate } from "./sim.js";

/**
 * Local demo feed used only until a real server has been observed. Once disabled it is retired for
 * the lifetime of the mounted editor, so a later disconnect keeps the last server snapshot instead
 * of restarting a high-frequency whole-canvas simulation.
 */
export function useSimulatedEntities(enabled: boolean): EntityMap {
  const [entities, setEntities] = useState<EntityMap>(() => simulate(0));
  const phase = useRef(0);
  const retired = useRef(false);

  useEffect(() => {
    if (!enabled) retired.current = true;
    if (!enabled || retired.current) return;
    const id = setInterval(() => {
      phase.current += 0.06;
      setEntities(simulate(phase.current));
    }, 90);
    return () => clearInterval(id);
  }, [enabled]);

  return entities;
}
