import { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { nodeGeom } from "../../../shared/node-types.js";
import { TYPE_VAR } from "../../../shared/theme.js";
import { cn } from "../cn.js";
import { Icon } from "../components/Icon.js";
import { DeviceClassIcon } from "../components/DeviceClassIcon.js";
import { HealthDot, MemBadge } from "../components/Badges.js";
import { ValueChip } from "../components/ValueChip.js";
import { DirSelect, OpSelect, PinValueEditor, SinkPanel, UnitSelect } from "../components/Widgets.js";
import { useResults } from "./results-context.js";
import type { PinDef } from "../../../shared/node-types.js";
import type { RWNodeType } from "./validation.js";

const HEADER = 40;
const PAD_T = 10;
const ROW = 28;
const pinTop = (i: number) => HEADER + PAD_T + ROW * i + ROW / 2;

// The visual dot inside the (larger, transparent) handle hit area.
function knobClass(pin: PinDef): string {
  return cn("rw-knob", pin.type === "any" && !pin.ghost && "rw-knob-any", pin.ghost && "rw-knob-ghost");
}

/** A graph node rendered on the React Flow canvas, with a Handle per typed pin. */
export function RWNode({ id, data, selected }: NodeProps<RWNodeType>) {
  const def = data.def;
  const { results, actuating, entities, onConfig, onSetValue } = useResults();
  const g = nodeGeom(def);
  const health = results.health[id] ?? "ok";

  // For an entity node, the device class of its live entity selects a small symbol shown next to
  // the state value. It is unknown for non-entity nodes and for entities the feed does not report.
  const deviceClass =
    def.type === "entity"
      ? entities[String(def.config?.entity_id ?? "")]?.attributes?.device_class
      : undefined;

  // A variadic node's handle count changes as pins grow; tell React Flow to re-measure the
  // handle positions whenever the input row count changes, or wires would point at stale rows.
  const updateNodeInternals = useUpdateNodeInternals();
  const pinCount = def.inputs.length;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, pinCount, updateNodeInternals]);

  return (
    <div
      className={cn(
        "relative bg-rw-node border rounded-[11px] text-[12px]",
        selected
          ? "border-rw-sel shadow-[0_0_0_1.5px_var(--rw-sel),var(--rw-shadow)]"
          : health === "error"
            ? "border-rw-error shadow-rw"
            : health === "warn"
              ? "border-[color-mix(in_oklab,var(--rw-h-warn)_55%,var(--rw-node-border))] shadow-rw"
              : "border-rw-node-border shadow-rw",
      )}
      // The declared width is a floor; the node grows to fit its pin rows and
      // value chips (capped) so long labels or values are never clipped.
      style={{ width: "max-content", minWidth: g.w, maxWidth: g.w + 160 }}
    >
      {def.inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          type="target"
          position={Position.Left}
          id={p.id}
          className="rw-port"
          style={{ top: pinTop(i), ["--tc" as string]: p.ghost ? "var(--rw-h-error)" : TYPE_VAR[p.type] }}
        >
          <span className={knobClass(p)} />
        </Handle>
      ))}
      {def.outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          type="source"
          position={Position.Right}
          id={p.id}
          className="rw-port"
          style={{ top: pinTop(i), ["--tc" as string]: p.ghost ? "var(--rw-h-error)" : TYPE_VAR[p.type] }}
        >
          <span className={knobClass(p)} />
        </Handle>
      ))}

      <div
        className={cn(
          "rw-drag cursor-move h-10 box-border flex items-center gap-2 px-[11px] border-b border-rw-line-soft rounded-t-[11px]",
          health === "error" ? "bg-[color-mix(in_oklab,var(--rw-h-error)_13%,var(--rw-node-hdr))]" : "bg-rw-node-hdr",
        )}
      >
        <span className="text-rw-dim flex shrink-0">
          <Icon name={def.icon} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11.5px] font-medium tracking-[-.01em] text-rw-text whitespace-nowrap overflow-hidden text-ellipsis">
            {def.title}
          </div>
          <div className="text-[9px] text-rw-faint uppercase tracking-[.05em] mt-px whitespace-nowrap overflow-hidden text-ellipsis">
            {def.subtitle}
          </div>
        </div>
        {def.stateful && <MemBadge />}
        <HealthDot health={health} />
      </div>

      <div className="relative pt-[10px] pb-3">
        <div className="flex justify-between items-start gap-2" style={{ height: g.rows * ROW }}>
          <div className="flex flex-col min-w-0">
            {def.inputs.map((p) => {
              const editing = p.editable && !results.connected[`${id}:${p.id}`];
              return (
                <div key={p.id} className="relative flex items-center h-7 pl-[15px] pr-1 gap-1.5">
                  {editing ? (
                    <>
                      <span className="text-[10.5px] text-rw-dim shrink-0">{p.label}</span>
                      <div className="w-[104px] flex justify-start">
                        <PinValueEditor compact value={def.values?.[p.id]} type={results.inputs[`${id}:${p.id}`]?.type ?? p.type} onChange={(v) => onSetValue(id, p.id, v)} />
                      </div>
                    </>
                  ) : p.ghost ? (
                    <>
                      <span className="text-[11px] whitespace-nowrap text-rw-error">{p.label}</span>
                      <span className="font-mono text-[9px] text-rw-error px-[5px] py-px rounded-[4px] whitespace-nowrap border border-dashed bg-[color-mix(in_oklab,var(--rw-h-error)_14%,transparent)] border-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)]">
                        missing: {p.missing}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] whitespace-nowrap text-rw-dim">
                      {p.variadic ? <span className="text-rw-faint italic text-[10.5px]">+ add input</span> : p.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-col items-end min-w-0">
            {def.outputs.map((p) => (
              <div key={p.id} className="relative flex items-center justify-end h-7 pr-[15px] pl-1 gap-1.5">
                {p.editable ? (
                  <div className="w-[104px] flex justify-end">
                    <PinValueEditor compact value={def.values?.[p.id]} type={p.type} onChange={(v) => onSetValue(id, p.id, v)} />
                  </div>
                ) : (
                  <>
                    <span className={cn("text-[11px] whitespace-nowrap", p.ghost ? "text-rw-error" : "text-rw-dim")}>{p.label}</span>
                    {p.id === "state" && <DeviceClassIcon deviceClass={deviceClass} />}
                    <ValueChip value={results.outputs[`${id}:${p.id}`]} unit={p.unit} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        {def.type === "compare" && (
          <div className="mx-3 mt-2 flex items-center gap-1.5">
            <span className="text-[10px] text-rw-faint">op</span>
            <OpSelect value={String(def.config?.op ?? "<")} type={results.inputs[`${id}:a`]?.type ?? "any"} onChange={(v) => onConfig(id, { op: v })} />
          </div>
        )}
        {def.type === "duration" && (
          <div className="mx-3 mt-2 flex items-center gap-1.5">
            <span className="text-[10px] text-rw-faint">unit</span>
            <UnitSelect value={String(def.config?.unit ?? "min")} onChange={(v) => onConfig(id, { unit: v })} />
          </div>
        )}
        {def.type === "dt-shift" && (
          <div className="mx-3 mt-2 flex items-center gap-1.5">
            <span className="text-[10px] text-rw-faint">dir</span>
            <DirSelect value={String(def.config?.dir ?? "plus")} onChange={(v) => onConfig(id, { dir: v })} />
          </div>
        )}
        {def.widget === "sink" && <SinkPanel action={results.actions[id]} actuating={actuating} />}
      </div>
    </div>
  );
}
