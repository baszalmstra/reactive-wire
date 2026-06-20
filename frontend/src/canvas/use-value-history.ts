import { useEffect, useRef, useState } from "react";
import type { EvalResults } from "../../../shared/results.js";
import type { Sample } from "../components/Sparkline.js";

/** How many recent samples to keep per observed pin. */
const CAPACITY = 60;
/** Minimum gap between samples so a fast render loop does not flood the buffer. */
const MIN_INTERVAL_MS = 250;

/**
 * Keeps a bounded ring buffer of recent values for a set of observed pins. The engine pushes
 * current values on every evaluate; this records them (throttled) so the inspector can draw a
 * sparkline without the engine having any history of its own. Only the observed keys are buffered,
 * so switching the selection drops the cost of tracking everything on the canvas.
 *
 * @param results  the latest evaluation output
 * @param keys     the `nodeId:pinId` keys to observe (e.g. the selected node's output pins)
 */
export function useValueHistory(results: EvalResults, keys: string[]): Record<string, Sample[]> {
  const [history, setHistory] = useState<Record<string, Sample[]>>({});
  // The keys are read inside the sampling effect without making it a dependency, so a selection
  // change does not reset the timing of the buffer.
  const keysRef = useRef<string[]>(keys);
  keysRef.current = keys;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const lastSampled = useRef(0);

  // Drop buffers for pins no longer observed so memory tracks the current selection.
  const keySig = keys.join("|");
  useEffect(() => {
    setHistory((h) => {
      const next: Record<string, Sample[]> = {};
      let changed = false;
      for (const k of keysRef.current) {
        if (h[k]) next[k] = h[k];
      }
      for (const k in h) {
        if (!(k in next)) changed = true;
      }
      return changed ? next : h;
    });
  }, [keySig]);

  // Sample on a steady tick rather than on every render, so a busy evaluate loop does not flood
  // the buffer and the sparkline advances at a readable rate.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (now - lastSampled.current < MIN_INTERVAL_MS) return;
      lastSampled.current = now;
      const obs = keysRef.current;
      if (!obs.length) return;
      const r = resultsRef.current;
      setHistory((h) => {
        const next = { ...h };
        let changed = false;
        for (const k of obs) {
          const v = r.outputs[k];
          if (!v) continue;
          const buf = h[k] ?? [];
          const grown = buf.concat({ value: v, t: now });
          next[k] = grown.length > CAPACITY ? grown.slice(grown.length - CAPACITY) : grown;
          changed = true;
        }
        return changed ? next : h;
      });
    };
    const id = setInterval(tick, MIN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return history;
}
