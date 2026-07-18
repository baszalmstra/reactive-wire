import type { NodeDef } from "../node-def.js";

// Registry lookup is the deliberate type-erasure boundary: validation dispatches by the runtime
// string, while each exported built-in definition below retains its literal config contract.
type RegisteredNodeDef = NodeDef<any>;
import { createRecord, setOwn } from "../../record.js";
import { entity } from "./entity.js";
import { fetch } from "./fetch.js";
import { compare } from "./compare.js";
import { between } from "./between.js";
import { and, or, not } from "./logic.js";
import { sum } from "./sum.js";
import { constNumber, constBool, constString, constColor, constDuration } from "./const.js";
import { select } from "./select.js";
import { toggle } from "./toggle.js";
import { edge, rising, falling } from "./edge.js";
import { hold } from "./hold.js";
import { fold, scan } from "./fold.js";
import { passthrough } from "./passthrough.js";
import { macroIn, macroOut } from "./boundary.js";
import { now, since, datetimeSubtract, datetimeShift, duration } from "./time.js";
import { timeOfDay, twilight } from "./environment-time.js";
import { sinkLight } from "./sink-light.js";
import { sinkCall } from "./sink-call.js";
import { sinkClimate } from "./sink-climate.js";
import { sinkCover } from "./sink-cover.js";
import { sinkInput } from "./sink-input.js";
import { sinkNotify, sinkTts } from "./sink-transient.js";

/**
 * Every node type that appears in the palette, in palette order. Each is a self-contained
 * definition: its template, description, and eval. The passthrough node is intentionally absent
 * — it has no palette entry and is only produced by macro expansion (see PALETTE_DEFS vs ALL).
 */
const PALETTE_DEFS: RegisteredNodeDef[] = [
  entity,
  fetch,
  compare,
  between,
  and,
  or,
  not,
  sum,
  constNumber,
  constBool,
  constString,
  constColor,
  constDuration,
  select,
  toggle,
  edge,
  rising,
  falling,
  hold,
  fold,
  scan,
  now,
  timeOfDay,
  twilight,
  since,
  datetimeSubtract,
  datetimeShift,
  duration,
  sinkLight,
  sinkCall,
  sinkClimate,
  sinkCover,
  sinkInput,
  sinkNotify,
  sinkTts,
];

/**
 * Definitions the engine dispatches over but the palette never shows (macro internals). The
 * boundary nodes only appear inside a macro definition canvas and are dropped during expansion;
 * they live here so that canvas previews them as a known type rather than an unknown one.
 */
const INTERNAL_DEFS: RegisteredNodeDef[] = [passthrough, macroIn, macroOut];

/** The palette-visible definitions, in palette order. */
export const paletteDefs: readonly RegisteredNodeDef[] = PALETTE_DEFS;

/** Every definition the engine can dispatch over, keyed by node type. */
export const REGISTRY: Record<string, RegisteredNodeDef> = (() => {
  const registry = createRecord<RegisteredNodeDef>();
  for (const def of [...PALETTE_DEFS, ...INTERNAL_DEFS]) setOwn(registry, def.type, def);
  return registry;
})();
