import { useId, useState } from "react";
import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";
import type { EntityMap } from "../../../shared/entities.js";
import { TYPE_VAR, TYPE_LABEL } from "../../../shared/theme.js";
import { formatValue, type RWValue } from "../../../shared/value.js";
import { Icon } from "../components/Icon.js";
import { DeviceClassIcon } from "../components/DeviceClassIcon.js";
import { HealthDot, MemBadge } from "../components/Badges.js";
import { EntityPicker } from "./EntityPicker.js";
import { DirSelect, LightPreview, UnitSelect } from "../components/Widgets.js";
import { describeNode } from "./node-templates.js";
import { NodeValueEditors } from "./NodeValueEditors.js";
import { Sparkline, type Sample } from "../components/Sparkline.js";
import { isMacroInstance, macroHasMemory, type MacroMap } from "../../../shared/macros.js";
import { cn } from "../cn.js";
import { pinKey } from "../../../shared/identity.js";
import type { HomeLocation } from "../../../shared/home.js";
import { TWILIGHT_BOUNDARIES, twilightBoundary, twilightBoundaryIndex } from "../../../shared/twilight.js";

/** Sink node types whose target is a Home Assistant entity, and the picker domains they allow. */
const SINK_ENTITY_DOMAINS: Record<string, string[] | undefined> = {
  "sink-light": ["light"],
  "sink-climate": ["climate"],
  "sink-cover": ["cover"],
  "sink-input": ["input_boolean", "input_number", "input_select", "input_text"],
  "sink-tts": ["media_player"],
  "sink-call": undefined,
};

function TypeChip({ type }: { type: NodeData["outputs"][number]["type"] }) {
  return (
    <span className="rw-typechip" style={{ ["--tc" as string]: TYPE_VAR[type] }}>
      <span className="rw-typechip-dot" />
      {TYPE_LABEL[type]}
    </span>
  );
}

type Diagnostic = { severity: "error" | "warn"; text: string };

function diagnosticsFor(node: NodeData, results: EvalResults): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const p of node.outputs) {
    const label = p.label || p.id;
    const v = results.outputs[pinKey(node.id, p.id)];
    if (p.ghost) out.push({ severity: "error", text: `Output '${label}' is a missing entity attribute.` });
    else if (v?.status === "error") out.push({ severity: "error", text: v.msg ? `Output '${label}' error: ${v.msg}` : `Output '${label}' is in an error state.` });
    else if (v?.status === "unavailable") out.push({ severity: "warn", text: `Output '${label}' is unavailable.` });
    else if (v?.status === "stale") out.push({ severity: "warn", text: `Output '${label}' is stale; showing the last known value.` });
  }
  for (const p of node.inputs) {
    const label = p.label || p.id;
    const v = results.inputs[pinKey(node.id, p.id)];
    if (v?.status === "error") out.push({ severity: "error", text: v.msg ? `Input '${label}' error: ${v.msg}` : `Input '${label}' is in an error state.` });
    else if (v?.status === "unavailable") out.push({ severity: "warn", text: `Input '${label}' is unavailable.` });
    else if (v?.status === "stale") out.push({ severity: "warn", text: `Input '${label}' is stale; showing the last known value.` });
  }
  const action = results.actions[node.id];
  if (action?.status === "error") out.push({ severity: "error", text: action.note ? `Sink action is blocked: ${action.note}.` : "Sink action is blocked by an error." });
  else if (action?.status === "unavailable") out.push({ severity: "warn", text: action.note ? `Sink action is holding: ${action.note}.` : "Sink action is holding because a required value is unavailable." });
  else if (action?.status === "stale") out.push({ severity: "warn", text: action.note ? `Sink action is stale: ${action.note}.` : "Sink action is based on stale values." });
  return out;
}

function BigValue({ value, unit, deviceClass, timeZone }: { value: RWValue | undefined; unit?: string; deviceClass?: unknown; timeZone?: string }) {
  const f = formatValue(value, timeZone);
  const typeColor = value && (value.status === "ok" || value.status === "stale") ? TYPE_VAR[value.type] : undefined;
  const cls = cn(
    "rw-bigval",
    f.kind === "error" && "err",
    (f.kind === "unavail" || f.kind === "none") && "unavail",
    f.stale && "stale",
  );

  if (f.kind === "error") {
    return <span className={cls}><span className="rw-bv-ico">⚠</span>error</span>;
  }
  if (f.kind === "unavail") return <span className={cls}>— unavailable</span>;
  if (f.kind === "none") return <span className={cls}>—</span>;

  return (
    <span className={cls} style={{ ["--tc" as string]: typeColor }}>
      {deviceClass ? <DeviceClassIcon deviceClass={deviceClass} /> : null}
      {f.kind === "bool" && <span className={cn("rw-booldot lg", f.bool && "on")} />}
      {f.kind === "color" && <span className="rw-swatch lg" style={{ background: f.swatch }} />}
      <span>{f.text}</span>
      {unit && f.kind === "num" ? <span className="rw-unit">{unit}</span> : null}
    </span>
  );
}

const TWILIGHT_POINTS = [
  { x: 20, y: 112 }, { x: 39, y: 94 }, { x: 58, y: 76 }, { x: 78, y: 58 },
  { x: 186, y: 58 }, { x: 206, y: 76 }, { x: 225, y: 94 }, { x: 244, y: 112 },
] as const;

// One idealized, symmetric category profile. Segment boundaries coincide with the eight factual
// solar-elevation events; this is a guide to twilight geometry, not today's measured solar path.
const TWILIGHT_COURSE_SEGMENTS = [
  "M 8 126 Q 14 120 20 112",
  "M 20 112 Q 30 103 39 94",
  "M 39 94 Q 49 85 58 76",
  "M 58 76 Q 68 66 78 58",
  "M 78 58 C 101 35 119 25 132 24 C 145 25 163 35 186 58",
  "M 186 58 Q 196 66 206 76",
  "M 206 76 Q 215 85 225 94",
  "M 225 94 Q 234 103 244 112",
  "M 244 112 Q 250 120 256 126",
] as const;

function TwilightGuide({ start, end }: { start: unknown; end: unknown }) {
  const headingId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const startIndex = twilightBoundaryIndex(start);
  const endIndex = twilightBoundaryIndex(end);
  const startInfo = twilightBoundary(start);
  const endInfo = twilightBoundary(end);
  const wrapped = startIndex >= 0 && endIndex >= 0 && endIndex <= startIndex;
  const selectionPaths = startIndex < 0 || endIndex < 0
    ? []
    : wrapped
      ? [TWILIGHT_COURSE_SEGMENTS.slice(startIndex + 1).join(" "), TWILIGHT_COURSE_SEGMENTS.slice(0, endIndex + 1).join(" ")]
      : [TWILIGHT_COURSE_SEGMENTS.slice(startIndex + 1, endIndex + 1).join(" ")];
  const title = startInfo && endInfo ? `Solar-angle twilight profile: ${startInfo.label} to ${endInfo.label}` : "Solar-angle twilight profile";
  const description = startInfo && endInfo
    ? `Idealized category guide with ${wrapped ? "a wrapped selection shown as two edge fragments continuing into the next day" : "one selected course fragment"}. Start is ${startInfo.label}; end is ${endInfo.label}. This is not today's measured solar path.`
    : "Idealized category guide showing day and twilight thresholds; no valid range is selected. This is not today's measured solar path.";
  const startPoint = startIndex >= 0 ? TWILIGHT_POINTS[startIndex] : undefined;
  const endPoint = endIndex >= 0 ? TWILIGHT_POINTS[endIndex] : undefined;

  return (
    <section className="rw-twilight-guide" role="group" aria-labelledby={headingId}>
      <h4 id={headingId} className="rw-twilight-heading">Twilight period guide</h4>
      <svg className="rw-twilight-profile" viewBox="0 0 264 158" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}</desc>
        <rect className="rw-twilight-band day" x="0" y="8" width="264" height="50" />
        <rect className="rw-twilight-band civil" x="0" y="58" width="264" height="18" />
        <rect className="rw-twilight-band nautical" x="0" y="76" width="264" height="18" />
        <rect className="rw-twilight-band astronomical" x="0" y="94" width="264" height="18" />
        <rect className="rw-twilight-band night" x="0" y="112" width="264" height="40" />
        {[{ y: 58, label: "horizon / 0°" }, { y: 76, label: "−6°" }, { y: 94, label: "−12°" }, { y: 112, label: "−18°" }].map((rule) => (
          <g key={rule.label} className="rw-twilight-threshold">
            <line x1="0" x2="264" y1={rule.y} y2={rule.y} />
            <text x="5" y={rule.y - 5}>{rule.label}</text>
          </g>
        ))}
        <g className="rw-twilight-phase-label">
          <rect x="17" y="9" width="43" height="15" rx="3" />
          <text className="rw-twilight-phase" x="24" y="20">dawn</text>
        </g>
        <g className="rw-twilight-phase-label">
          <rect x="106" y="9" width="52" height="15" rx="3" />
          <text className="rw-twilight-phase" x="132" y="20" textAnchor="middle">day sky</text>
        </g>
        <g className="rw-twilight-phase-label">
          <rect x="204" y="9" width="43" height="15" rx="3" />
          <text className="rw-twilight-phase" x="240" y="20" textAnchor="end">dusk</text>
        </g>
        <path className="rw-twilight-course" d={TWILIGHT_COURSE_SEGMENTS.join(" ")} />
        {selectionPaths.map((path, index) => (
          <g key={index} className="rw-twilight-selected-fragment" data-fragment={index + 1}>
            <path className="rw-twilight-selection-outer" d={path} />
            <path className="rw-twilight-selection-inner" d={path} />
          </g>
        ))}
        {wrapped ? (
          <g className="rw-twilight-continuation" aria-hidden="true">
            <text x="8" y="148">← continues</text><text x="256" y="148" textAnchor="end">continues →</text>
          </g>
        ) : null}
        {TWILIGHT_BOUNDARIES.map((boundary, index) => {
          const point = TWILIGHT_POINTS[index]!;
          return <circle key={boundary.id} className="rw-twilight-boundary-marker" data-boundary={boundary.id} cx={point.x} cy={point.y} r="2.7"><title>{boundary.label}, {boundary.elevation}</title></circle>;
        })}
        {startPoint ? <g className="rw-twilight-endpoint start"><polygon points={`${startPoint.x},${startPoint.y - 6} ${startPoint.x + 6},${startPoint.y} ${startPoint.x},${startPoint.y + 6} ${startPoint.x - 6},${startPoint.y}`} /><text x={startPoint.x} y={startPoint.y - 8} textAnchor="middle">S</text></g> : null}
        {endPoint ? <g className="rw-twilight-endpoint end"><rect x={endPoint.x - 5} y={endPoint.y - 5} width="10" height="10" rx="1" /><text x={endPoint.x} y={endPoint.y + 15} textAnchor="middle">E</text></g> : null}
      </svg>
      <p className="rw-twilight-disclaimer">Idealized sun-angle guide — not today’s measured solar path</p>
      <p className="rw-twilight-key"><b>Day</b> above horizon · <b>Civil</b> 0 to −6° · <b>Nautical</b> −6 to −12° · <b>Astronomical</b> −12 to −18° · <b>Night</b> below −18°.</p>
      {startInfo && endInfo ? <p className="rw-twilight-summary">Selected range: <b>S</b> {startInfo.label} → <b>E</b> {endInfo.label}{wrapped ? " · wraps to next day in two continuing fragments" : " · one course fragment"}</p> : null}
    </section>
  );
}

/** The right-hand panel: live values and config editors for the selected node. */
export function Inspector({
  node,
  results,
  entities,
  homeLocation = null,
  history = {},
  macros = {},
  onConfig,
  onSetValue,
  onEditMacro,
}: {
  node: NodeData | null;
  results: EvalResults;
  entities: EntityMap;
  homeLocation?: HomeLocation | null;
  /** Recent value samples for the selected node's output pins, keyed by `nodeId:pinId`. */
  history?: Record<string, Sample[]>;
  /** The macro library, used to inspect a selected macro instance's definition. */
  macros?: MacroMap;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onSetValue: (id: string, pin: string, value: unknown) => void;
  /** Open the definition canvas for a macro id (the inspector's "Edit macro" action). */
  onEditMacro?: (macroId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="rw-inspector collapsed">
        <button className="rw-insp-expand" onClick={() => setCollapsed(false)} title="Expand inspector" aria-label="Expand inspector">‹</button>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="rw-inspector">
        <button className="rw-insp-collapse" onClick={() => setCollapsed(true)} title="Collapse inspector" aria-label="Collapse inspector">›</button>
        <div className="rw-insp-empty">
          <div className="rw-insp-empty-glyph"><Icon name="sel" size={22} /></div>
          <p>Select a node to inspect its live value and edit its settings.</p>
        </div>
      </aside>
    );
  }

  const cfg = node.config ?? {};
  const set = (patch: Record<string, unknown>) => onConfig(node.id, patch);
  const health = results.health[node.id] ?? "ok";
  const description = describeNode(node.type);

  // A macro instance: its definition, derived pin interface, and memory state. The badge mirrors
  // whether anything inside the macro (recursively) carries memory.
  const isMacro = isMacroInstance(node.type);
  const macroDef = isMacro ? macros[String(cfg.macroId ?? "")] : undefined;
  const macroMemory = macroDef ? macroHasMemory(macroDef, macros) : !!node.stateful;

  // An entity node's state value carries a device-class symbol drawn from the live feed.
  const deviceClass = node.type === "entity" ? entities[String(cfg.entity_id ?? "")]?.attributes?.device_class : undefined;
  const healthLabel = health === "ok" ? "healthy" : health === "warn" ? "warning" : "error";
  const diagnostics = diagnosticsFor(node, results);

  return (
    <aside className="rw-inspector">
      <div className="rw-insp-hd">
        <span className="rw-insp-ico"><Icon name={node.icon} /></span>
        <div className="rw-insp-titles">
          <div className="rw-insp-title">{node.title}</div>
          <div className="rw-insp-sub">{node.subtitle}</div>
        </div>
        <button className="rw-insp-collapse" onClick={() => setCollapsed(true)} title="Collapse inspector" aria-label="Collapse inspector">›</button>
      </div>

      <div className="rw-insp-scroll">
        <div className="rw-insp-healthrow">
          <HealthDot health={health} />
          <span className={cn("rw-health-label", health)}>{healthLabel}</span>
          {macroMemory ? <span className="rw-mem-label"><MemBadge />uses memory</span> : null}
        </div>

        {description && <p className="rw-insp-desc">{description}</p>}

        {diagnostics.length > 0 && (
          <>
            <div className="rw-insp-sect">Diagnostics</div>
            <div className="rw-diag-list">
              {diagnostics.map((d, i) => (
                <div key={i} className={cn("rw-diag", d.severity)}>
                  <span className="rw-diag-icon">{d.severity === "error" ? "!" : "△"}</span>
                  <span>{d.text}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {node.type === "sink-light" && (
          <>
            <div className="rw-insp-sect">Light</div>
            <div className="rw-insp-card">
              <LightPreview
                on={results.inputs[pinKey(node.id, "on")]}
                color={results.inputs[pinKey(node.id, "color")]}
                temperature={results.inputs[pinKey(node.id, "temperature")]}
                brightness={results.inputs[pinKey(node.id, "brightness")]}
              />
            </div>
          </>
        )}

        {isMacro && (
          <>
            <div className="rw-insp-sect">Macro</div>
            {macroDef ? (
              <div className="rw-insp-card">
                <div className="rw-insp-card-row">
                  <span className="rw-insp-ico"><Icon name="macro" size={15} /></span>
                  <span className="rw-insp-card-title">{macroDef.name}</span>
                  {macroMemory ? <MemBadge /> : null}
                </div>
                <p className="rw-cfg-note">
                  {macroDef.inputs.length} input{macroDef.inputs.length === 1 ? "" : "s"} · {" "}
                  {macroDef.outputs.length} output{macroDef.outputs.length === 1 ? "" : "s"} · {" "}
                  {macroMemory ? "uses memory" : "stateless"}
                </p>
                <button onClick={() => onEditMacro?.(macroDef.id)} className="rw-btn primary sm self-start">Edit macro</button>
              </div>
            ) : (
              <p className="rw-cfg-note">
                This placement's definition is missing from the library — its wiring is preserved, but it cannot be edited or evaluated.
              </p>
            )}
          </>
        )}

        {node.outputs.length > 0 && (
          <>
            <div className="rw-insp-sect">Live value</div>
            <div className="rw-insp-values">
              {node.outputs.map((p) => (
                <div key={p.id} className="rw-insp-val">
                  <div className="rw-insp-val-label">
                    <span>{p.label || p.id}</span>
                    <TypeChip type={p.type} />
                  </div>
                  <BigValue value={results.outputs[pinKey(node.id, p.id)]} unit={p.unit} deviceClass={p.id === "state" ? deviceClass : undefined} timeZone={homeLocation?.timeZone} />
                </div>
              ))}
            </div>

            <div className="rw-insp-sect">Value history</div>
            <div className="rw-insp-history">
              {node.outputs.map((p) => (
                <div key={p.id} className="rw-insp-spark-block">
                  {node.outputs.length > 1 && <span className="rw-pinlist-h">{p.label || p.id}</span>}
                  <Sparkline history={history[pinKey(node.id, p.id)] ?? []} timeZone={homeLocation?.timeZone} />
                </div>
              ))}
            </div>
          </>
        )}

        <div className="rw-insp-sect">Settings</div>
        <div className="rw-cfg-stack">
          {(node.type === "entity" || node.type in SINK_ENTITY_DOMAINS) && (
            <label className="rw-cfg-field">
              <span>entity id</span>
              <EntityPicker
                value={String(cfg.entity_id ?? "")}
                onChange={(v) => set({ entity_id: v })}
                entities={entities}
                domains={node.type === "entity" ? undefined : SINK_ENTITY_DOMAINS[node.type]}
              />
            </label>
          )}

          {(node.type === "sink-call" || node.type === "sink-notify" || node.type === "sink-tts") && (
            <>
              <label className="rw-cfg-field">
                <span>{node.type === "sink-call" ? "domain" : "service"}</span>
                <input className="rw-input" value={String(node.type === "sink-call" ? cfg.domain ?? "" : cfg.service ?? "")} onChange={(e) => set(node.type === "sink-call" ? { domain: e.target.value } : { service: e.target.value })} />
              </label>
              {node.type === "sink-call" && (
                <>
                  <label className="rw-cfg-field">
                    <span>service (on)</span>
                    <input className="rw-input" value={String(cfg.service ?? "")} onChange={(e) => set({ service: e.target.value })} />
                  </label>
                  <label className="rw-cfg-field">
                    <span>service (off)</span>
                    <input className="rw-input" value={String(cfg.service_off ?? "")} onChange={(e) => set({ service_off: e.target.value })} />
                  </label>
                </>
              )}
            </>
          )}

          {node.type === "fetch" && (
            <>
              <label className="rw-cfg-field">
                <span>url</span>
                <input className="rw-input" value={String(cfg.url ?? "")} placeholder="https://api.example.com/data" onChange={(e) => set({ url: e.target.value })} />
              </label>
              <label className="rw-cfg-field">
                <span>json path</span>
                <input className="rw-input" value={String(cfg.path ?? "")} placeholder="main.temp" onChange={(e) => set({ path: e.target.value })} />
              </label>
              <label className="rw-cfg-field">
                <span>poll interval (s)</span>
                <input type="number" min={1} className="rw-input rw-num" value={Number(cfg.interval ?? 60)} onChange={(e) => set({ interval: Number(e.target.value) })} />
              </label>
              <p className="rw-cfg-note">Fetching runs on the server after deploy. The preview shows the value as loading until then.</p>
            </>
          )}

          {node.type === "time-of-day" && (
            <>
              <label className="rw-cfg-field">
                <span>Home-local time</span>
                <input type="time" aria-label="Home-local time" className="rw-input" value={String(cfg.time ?? "")} onChange={(e) => set({ time: e.target.value })} />
              </label>
              <p className="rw-cfg-note">Resolves this wall-clock time on today’s Home Assistant calendar date.</p>
              <p className="rw-home-location">{homeLocation ? `${homeLocation.timeZone} · ${homeLocation.latitude.toFixed(3)}, ${homeLocation.longitude.toFixed(3)}` : "Home Assistant location unavailable"}</p>
            </>
          )}

          {node.type === "twilight" && (
            <>
              <label className="rw-cfg-field">
                <span>Start boundary</span>
                <select aria-label="Start boundary" className="rw-input" value={String(cfg.start ?? "")} onChange={(e) => set({ start: e.target.value })}>
                  {TWILIGHT_BOUNDARIES.map((boundary) => <option key={boundary.id} value={boundary.id}>{boundary.label} ({boundary.elevation})</option>)}
                </select>
              </label>
              <label className="rw-cfg-field">
                <span>End boundary</span>
                <select aria-label="End boundary" className="rw-input" value={String(cfg.end ?? "")} onChange={(e) => set({ end: e.target.value })}>
                  {TWILIGHT_BOUNDARIES.map((boundary) => <option key={boundary.id} value={boundary.id}>{boundary.label} ({boundary.elevation})</option>)}
                </select>
              </label>
              <TwilightGuide start={cfg.start} end={cfg.end} />
              <p className="rw-home-location">Calculated for {homeLocation ? `${homeLocation.timeZone} · ${homeLocation.latitude.toFixed(3)}, ${homeLocation.longitude.toFixed(3)}` : "an unavailable Home Assistant location"}</p>
            </>
          )}

          {node.type === "duration" && (
            <label className="rw-cfg-row">
              <span>unit</span>
              <UnitSelect value={String(cfg.unit ?? "min")} onChange={(v) => set({ unit: v })} />
            </label>
          )}

          {node.type === "dt-shift" && (
            <label className="rw-cfg-row">
              <span>dir</span>
              <DirSelect value={String(cfg.dir ?? "plus")} onChange={(v) => set({ dir: v })} />
            </label>
          )}

          <NodeValueEditors node={node} results={results} onConfig={onConfig} onSetValue={onSetValue} inset />

          {["and", "or", "not", "select", "toggle"].includes(node.type) && (
            <p className="rw-cfg-note">No editable settings — behavior is fixed by the node type.</p>
          )}

          {isMacro && (
            <p className="rw-cfg-note">
              Unwired inputs accept a literal default above. The macro's behavior lives in its definition — open it with “Edit macro”.
            </p>
          )}
        </div>

        <div className="rw-insp-sect">Pins</div>
        <div className="rw-pinlist">
          {node.inputs.length > 0 && <div className="rw-pinlist-h">Inputs</div>}
          {node.inputs.map((p) => (
            <div key={`i-${p.id}`} className="rw-pinlist-row">
              <span className="rw-pin-dir">↦</span>
              <span className="rw-pin-name">{p.label || p.id || "in"}</span>
              <TypeChip type={p.type} />
            </div>
          ))}
          {node.outputs.length > 0 && <div className="rw-pinlist-h">Outputs</div>}
          {node.outputs.map((p) => (
            <div key={`o-${p.id}`} className="rw-pinlist-row">
              <span className="rw-pin-dir">↤</span>
              <span className="rw-pin-name">{p.label || p.id}</span>
              <TypeChip type={p.type} />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
