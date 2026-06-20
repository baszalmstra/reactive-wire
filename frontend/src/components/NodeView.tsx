import type { PointerEvent } from "react";
import { nodeGeom, type NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";
import { cn } from "../cn.js";
import { Icon } from "./Icon.js";
import { HealthDot, MemBadge } from "./Badges.js";
import { Pin, type PinShape, type PinSide } from "./Pin.js";
import { PinValueEditor, SinkPanel } from "./Widgets.js";
import type { Anatomy } from "./ValueChip.js";

export interface NodeViewProps {
  node: NodeData;
  results: EvalResults;
  selected?: boolean;
  anatomy?: Anatomy;
  pinShape?: PinShape;
  actuating?: boolean;
  hotPin?: { node: string; pin: string; side: PinSide } | null;
  onSelect?: (id: string, e: PointerEvent) => void;
  onHeaderDown?: (e: PointerEvent, id: string) => void;
  onPinDown?: (e: PointerEvent, side: PinSide, pinId: string) => void;
  onPinUp?: (e: PointerEvent, side: PinSide, pinId: string) => void;
  onConfig?: (id: string, patch: Record<string, unknown>) => void;
}

/** A complete node: header (icon, title, memory + health badges), pin columns, and an optional widget. */
export function NodeView({
  node,
  results,
  selected,
  anatomy,
  pinShape,
  actuating,
  hotPin,
  onSelect,
  onHeaderDown,
  onPinDown,
  onPinUp,
  onConfig,
}: NodeViewProps) {
  const g = nodeGeom(node);
  const health = results.health[node.id] ?? "ok";
  const isHot = (side: PinSide, pid: string) =>
    !!hotPin && hotPin.node === node.id && hotPin.pin === pid && hotPin.side === side;

  const border = selected
    ? "border-rw-sel"
    : health === "error"
      ? "border-rw-error"
      : health === "warn"
        ? "border-[color-mix(in_oklab,var(--rw-h-warn)_55%,var(--rw-node-border))]"
        : "border-rw-node-border";

  return (
    <div
      style={{ width: g.w }}
      onPointerDown={(e) => onSelect?.(node.id, e)}
      className={cn(
        "relative bg-rw-node border rounded-[11px] text-[12px] select-none transition-[box-shadow,border-color] duration-150",
        border,
        selected ? "shadow-[0_0_0_1.5px_var(--rw-sel),var(--rw-shadow)]" : "shadow-rw",
      )}
    >
      <div
        onPointerDown={(e) => onHeaderDown?.(e, node.id)}
        className={cn(
          "h-10 box-border flex items-center gap-2 px-[11px] border-b border-rw-line-soft cursor-move rounded-t-[11px]",
          health === "error" ? "bg-[color-mix(in_oklab,var(--rw-h-error)_13%,var(--rw-node-hdr))]" : "bg-rw-node-hdr",
        )}
      >
        <span className="text-rw-dim flex shrink-0">
          <Icon name={node.icon} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11.5px] font-medium tracking-[-.01em] text-rw-text whitespace-nowrap overflow-hidden text-ellipsis">
            {node.title}
          </div>
          <div className="text-[9px] text-rw-faint uppercase tracking-[.05em] mt-px whitespace-nowrap overflow-hidden text-ellipsis">
            {node.subtitle}
          </div>
        </div>
        {node.stateful && <MemBadge />}
        <HealthDot health={health} />
      </div>

      <div className="relative pt-[10px] pb-3">
        <div className="flex justify-between items-start relative" style={{ height: g.rows * 28 }}>
          <div className="flex flex-col">
            {node.inputs.map((p) => (
              <Pin
                key={p.id}
                side="in"
                pin={p}
                nodeId={node.id}
                value={results.inputs[`${node.id}:${p.id}`]}
                anatomy={anatomy}
                pinShape={pinShape}
                hot={isHot("in", p.id)}
                onPinDown={onPinDown}
                onPinUp={onPinUp}
              />
            ))}
          </div>
          <div className="flex flex-col items-end">
            {node.outputs.map((p) => (
              <Pin
                key={p.id}
                side="out"
                pin={p}
                nodeId={node.id}
                value={results.outputs[`${node.id}:${p.id}`]}
                anatomy={anatomy}
                pinShape={pinShape}
                hot={isHot("out", p.id)}
                onPinDown={onPinDown}
                onPinUp={onPinUp}
              />
            ))}
          </div>
        </div>
        {node.outputs
          .filter((p) => p.editable)
          .map((p) => (
            <div key={`v-${p.id}`} className="mx-3 mt-[9px]">
              <PinValueEditor value={node.values?.[p.id]} type={p.type} onChange={(v) => onConfig?.(node.id, { [p.id]: v })} />
            </div>
          ))}
        {node.widget === "sink" && <SinkPanel action={results.actions[node.id]} actuating={actuating} />}
      </div>
    </div>
  );
}
