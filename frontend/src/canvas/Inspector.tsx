import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";
import type { EntityMap } from "../../../shared/entities.js";
import { TYPE_VAR, TYPE_LABEL } from "../../../shared/theme.js";
import { Icon } from "../components/Icon.js";
import { DeviceClassIcon } from "../components/DeviceClassIcon.js";
import { HealthDot, MemBadge } from "../components/Badges.js";
import { ValueChip } from "../components/ValueChip.js";
import { EntityPicker } from "./EntityPicker.js";
import { DirSelect, UnitSelect } from "../components/Widgets.js";
import { describeNode } from "./node-templates.js";
import { NodeValueEditors } from "./NodeValueEditors.js";
import { Sparkline, type Sample } from "../components/Sparkline.js";
import { isMacroInstance, macroHasMemory, type MacroMap } from "../../../shared/macros.js";

/** Sink node types whose target is a Home Assistant entity, and the picker domains they allow. */
const SINK_ENTITY_DOMAINS: Record<string, string[] | undefined> = {
  "sink-light": ["light"],
  "sink-climate": ["climate"],
  "sink-cover": ["cover"],
  "sink-input": ["input_boolean", "input_number", "input_select", "input_text"],
  "sink-tts": ["media_player"],
  "sink-call": undefined,
};

const sectionTitle = "text-[10px] font-bold tracking-[.08em] uppercase text-rw-faint pt-4 pb-2";

function TypeChip({ type }: { type: NodeData["outputs"][number]["type"] }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] font-mono text-[10px] px-[7px] py-[1.5px] rounded-[5px] text-[var(--tc)] bg-[color-mix(in_oklab,var(--tc)_14%,transparent)] border-[0.5px] border-[color-mix(in_oklab,var(--tc)_30%,transparent)]"
      style={{ ["--tc" as string]: TYPE_VAR[type] }}
    >
      <span className="w-[7px] h-[7px] rounded-full bg-[var(--tc)]" />
      {TYPE_LABEL[type]}
    </span>
  );
}

/** The right-hand panel: live values and config editors for the selected node. */
export function Inspector({
  node,
  results,
  entities,
  history = {},
  macros = {},
  onConfig,
  onSetValue,
  onEditMacro,
}: {
  node: NodeData | null;
  results: EvalResults;
  entities: EntityMap;
  /** Recent value samples for the selected node's output pins, keyed by `nodeId:pinId`. */
  history?: Record<string, Sample[]>;
  /** The macro library, used to inspect a selected macro instance's definition. */
  macros?: MacroMap;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onSetValue: (id: string, pin: string, value: unknown) => void;
  /** Open the definition canvas for a macro id (the inspector's "Edit macro" action). */
  onEditMacro?: (macroId: string) => void;
}) {
  if (!node) {
    return (
      <aside className="w-[312px] flex-none bg-rw-panel border-l border-rw-line flex flex-col items-center justify-center text-center px-6 text-rw-faint">
        <div className="w-[52px] h-[52px] rounded-[13px] bg-rw-panel2 flex items-center justify-center mb-3">
          <Icon name="sel" size={22} />
        </div>
        <p className="text-[12px] leading-relaxed">Select a node to inspect its live value and edit its settings.</p>
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
  const deviceClass =
    node.type === "entity" ? entities[String(cfg.entity_id ?? "")]?.attributes?.device_class : undefined;

  return (
    <aside className="w-[312px] flex-none bg-rw-panel border-l border-rw-line flex flex-col min-h-0">
      <div className="flex items-center gap-[9px] px-[14px] py-[13px] border-b border-rw-line">
        <span className="text-rw-dim flex">
          <Icon name={node.icon} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">{node.title}</div>
          <div className="text-[10px] text-rw-faint uppercase tracking-[.04em] mt-[2px]">{node.subtitle}</div>
        </div>
        {isMacro && macroMemory && <MemBadge />}
        <HealthDot health={health} />
      </div>

      <div className="flex-1 overflow-y-auto px-[14px] pb-6">
        {description && (
          <p className="text-[11.5px] text-rw-dim leading-relaxed pt-3">{description}</p>
        )}

        {isMacro && (
          <>
            <div className={sectionTitle}>Macro</div>
            {macroDef ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-rw-dim flex"><Icon name="macro" size={15} /></span>
                  <span className="font-mono text-[12px] flex-1 truncate">{macroDef.name}</span>
                  {macroMemory ? <MemBadge /> : null}
                </div>
                <p className="text-[11px] text-rw-faint leading-relaxed">
                  {macroDef.inputs.length} input{macroDef.inputs.length === 1 ? "" : "s"} ·{" "}
                  {macroDef.outputs.length} output{macroDef.outputs.length === 1 ? "" : "s"} ·{" "}
                  {macroMemory ? "uses memory" : "stateless"}
                </p>
                <button
                  onClick={() => onEditMacro?.(macroDef.id)}
                  className="h-8 px-3 rounded-lg bg-rw-accent text-rw-accent-text font-bold text-[12px] cursor-pointer hover:brightness-110 self-start"
                >
                  Edit macro
                </button>
              </div>
            ) : (
              <p className="text-[11.5px] text-rw-faint leading-relaxed">
                This placement's definition is missing from the library — its wiring is preserved, but it cannot be edited or evaluated.
              </p>
            )}
          </>
        )}

        {node.outputs.length > 0 && (
          <>
            <div className={sectionTitle}>Live value</div>
            <div className="flex flex-col gap-2">
              {node.outputs.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-rw-dim">{p.label || p.id}</span>
                  <span className="flex items-center gap-1.5">
                    {p.id === "state" && <DeviceClassIcon deviceClass={deviceClass} />}
                    <ValueChip value={results.outputs[`${node.id}:${p.id}`]} unit={p.unit} />
                  </span>
                </div>
              ))}
            </div>

            <div className={sectionTitle}>Value history</div>
            <div className="flex flex-col gap-2.5">
              {node.outputs.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  {node.outputs.length > 1 && <span className="text-[10px] text-rw-faint">{p.label || p.id}</span>}
                  <Sparkline history={history[`${node.id}:${p.id}`] ?? []} />
                </div>
              ))}
            </div>
          </>
        )}

        <div className={sectionTitle}>Settings</div>
        <div className="flex flex-col gap-2.5">
          {(node.type === "entity" || node.type in SINK_ENTITY_DOMAINS) && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-rw-dim">entity id</span>
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
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-rw-dim">{node.type === "sink-call" ? "domain" : "service"}</span>
                <input
                  className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                  value={String(node.type === "sink-call" ? cfg.domain ?? "" : cfg.service ?? "")}
                  onChange={(e) => set(node.type === "sink-call" ? { domain: e.target.value } : { service: e.target.value })}
                />
              </label>
              {node.type === "sink-call" && (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-rw-dim">service (on)</span>
                    <input
                      className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                      value={String(cfg.service ?? "")}
                      onChange={(e) => set({ service: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-rw-dim">service (off)</span>
                    <input
                      className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                      value={String(cfg.service_off ?? "")}
                      onChange={(e) => set({ service_off: e.target.value })}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {node.type === "fetch" && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-rw-dim">url</span>
                <input
                  className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                  value={String(cfg.url ?? "")}
                  placeholder="https://api.example.com/data"
                  onChange={(e) => set({ url: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-rw-dim">json path</span>
                <input
                  className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                  value={String(cfg.path ?? "")}
                  placeholder="main.temp"
                  onChange={(e) => set({ path: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-rw-dim">poll interval (s)</span>
                <input
                  type="number"
                  min={1}
                  className="bg-rw-panel2 border border-rw-line rounded-[6px] px-2 py-1 text-[11.5px] font-mono"
                  value={Number(cfg.interval ?? 60)}
                  onChange={(e) => set({ interval: Number(e.target.value) })}
                />
              </label>
              <p className="text-[11px] text-rw-faint leading-relaxed">
                Fetching runs on the server after deploy. The preview shows the value as loading until then.
              </p>
            </>
          )}

          {node.type === "duration" && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-rw-dim w-12 shrink-0">unit</span>
              <UnitSelect value={String(cfg.unit ?? "min")} onChange={(v) => set({ unit: v })} />
            </label>
          )}

          {node.type === "dt-shift" && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-rw-dim w-12 shrink-0">dir</span>
              <DirSelect value={String(cfg.dir ?? "plus")} onChange={(v) => set({ dir: v })} />
            </label>
          )}

          <NodeValueEditors node={node} results={results} onConfig={onConfig} onSetValue={onSetValue} inset />

          {["and", "or", "not", "select", "toggle"].includes(node.type) && (
            <p className="text-[11.5px] text-rw-faint leading-relaxed">No editable settings — behavior is fixed by the node type.</p>
          )}

          {isMacro && (
            <p className="text-[11.5px] text-rw-faint leading-relaxed">
              Unwired inputs accept a literal default above. The macro's behavior lives in its definition — open it with “Edit macro”.
            </p>
          )}
        </div>

        <div className={sectionTitle}>Pins</div>
        <div className="flex flex-col gap-1.5">
          {node.inputs.map((p) => (
            <div key={`i-${p.id}`} className="flex items-center gap-[9px] text-[11.5px] text-rw-dim">
              <span className="text-rw-faint w-3">↦</span>
              <span className="flex-1">{p.label || p.id || "in"}</span>
              <TypeChip type={p.type} />
            </div>
          ))}
          {node.outputs.map((p) => (
            <div key={`o-${p.id}`} className="flex items-center gap-[9px] text-[11.5px] text-rw-dim">
              <span className="text-rw-faint w-3">↤</span>
              <span className="flex-1">{p.label || p.id}</span>
              <TypeChip type={p.type} />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
