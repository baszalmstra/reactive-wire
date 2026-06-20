import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { nodeGeom, pinPos, type NodeData } from "../../../shared/node-types.js";
import { gridStyle, TYPE_VAR, type Aesthetic } from "../../../shared/theme.js";
import type { EvalResults } from "../../../shared/results.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";
import { NodeView } from "../components/NodeView.js";
import { Wire } from "./Wire.js";

interface View {
  tx: number;
  ty: number;
  scale: number;
}
type Drag =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { mode: "node"; id: string; sx: number; sy: number; ox: number; oy: number }
  | null;

export interface CanvasProps {
  nodes: NodeData[];
  edges: ViewEdge[];
  results: EvalResults;
  aesthetic: Aesthetic;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
}

/** Pan/zoom/drag canvas that renders the graph's nodes and live, type-colored wires. */
export function Canvas({ nodes, edges, results, aesthetic, selected, onSelect, onMoveNode, onConfig }: CanvasProps) {
  const [view, setView] = useState<View>({ tx: 40, ty: 24, scale: 0.82 });
  const drag = useRef<Drag>(null);
  const ref = useRef<HTMLDivElement>(null);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const onWheel = (e: WheelEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => {
      const scale = Math.min(2.5, Math.max(0.3, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  };

  const startNodeDrag = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    onSelect(id);
    const n = byId[id];
    if (n) drag.current = { mode: "node", id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
  };

  const onBgDown = (e: PointerEvent) => {
    onSelect(null);
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.tx, oy: view.ty };
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      setView((v) => ({ ...v, tx: d.ox + (e.clientX - d.sx), ty: d.oy + (e.clientY - d.sy) }));
    } else {
      onMoveNode(d.id, d.ox + (e.clientX - d.sx) / view.scale, d.oy + (e.clientY - d.sy) / view.scale);
    }
  };

  const onUp = () => {
    drag.current = null;
  };

  const grid = gridStyle(aesthetic);
  const gs = 22 * view.scale;

  return (
    <div
      ref={ref}
      onPointerDown={onBgDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
      className={`absolute inset-0 overflow-hidden bg-rw-canvas cursor-grab active:cursor-grabbing touch-none ${
        grid === "lines" ? "rw-grid-lines" : "rw-grid-dots"
      }`}
      style={{ ["--gs" as string]: `${gs}px`, ["--gx" as string]: `${view.tx}px`, ["--gy" as string]: `${view.ty}px` }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
      >
        <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width={4000} height={3000}>
          {edges.map((edge) => {
            const from = byId[edge.from.node];
            const to = byId[edge.to.node];
            if (!from || !to) return null;
            const a = pinPos(from, "out", edge.from.pin);
            const b = pinPos(to, "in", edge.to.pin);
            if (!a || !b) return null;
            const out = results.outputs[`${edge.from.node}:${edge.from.pin}`];
            const dead = !out || out.status === "unavailable";
            const error = !!out && out.status === "error";
            const color = out && out.status !== "error" ? TYPE_VAR[out.type] : TYPE_VAR[a.type];
            return <Wire key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={color} dead={dead} error={error} />;
          })}
        </svg>

        {nodes.map((n) => {
          const g = nodeGeom(n);
          return (
            <div key={n.id} className="absolute" style={{ left: n.x, top: n.y, width: g.w }}>
              <NodeView
                node={n}
                results={results}
                selected={selected === n.id}
                onSelect={(_, e) => {
                  e.stopPropagation();
                  onSelect(n.id);
                }}
                onHeaderDown={startNodeDrag}
                onConfig={onConfig}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
