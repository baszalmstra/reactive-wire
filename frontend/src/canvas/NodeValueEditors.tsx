import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";
import { cn } from "../cn.js";
import { PinValueEditor, OpSelect } from "../components/Widgets.js";

/**
 * Inline editors for a node's editable pins: constant outputs (always), input defaults
 * (only while unconnected), plus a compare node's operator. Rendered both on the node
 * (canvas) and in the inspector. Returns null when the node has nothing to edit.
 */
export function NodeValueEditors({
  node,
  results,
  onConfig,
  onSetValue,
  inset,
}: {
  node: NodeData;
  results: EvalResults;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onSetValue: (id: string, pin: string, value: unknown) => void;
  inset?: boolean;
}) {
  const id = node.id;
  const outs = node.outputs.filter((p) => p.editable);
  const ins = node.inputs.filter((p) => p.editable && !results.connected[`${id}:${p.id}`]);
  const isCompare = node.type === "compare";
  if (!isCompare && outs.length === 0 && ins.length === 0) return null;

  // For a generic pin, prefer the resolved type from the live value.
  const typeOf = (pinId: string, fallback: string) => results.inputs[`${id}:${pinId}`]?.type ?? fallback;

  return (
    <div className={cn("flex flex-col gap-[9px]", !inset && "mx-3 mt-[9px]")}>
      {isCompare && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-rw-faint w-12 shrink-0">operator</span>
          <OpSelect value={String(node.config?.op ?? "<")} type={typeOf("a", "any")} onChange={(v) => onConfig(id, { op: v })} />
        </div>
      )}
      {outs.map((p) => (
        <PinValueEditor key={`o-${p.id}`} value={node.values?.[p.id]} type={p.type} onChange={(v) => onSetValue(id, p.id, v)} />
      ))}
      {ins.map((p) => (
        <div key={`i-${p.id}`} className="flex items-center gap-2">
          <span className="text-[10.5px] text-rw-dim w-12 shrink-0">{p.label || p.id}</span>
          <div className="flex-1">
            <PinValueEditor value={node.values?.[p.id]} type={typeOf(p.id, p.type)} onChange={(v) => onSetValue(id, p.id, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}
