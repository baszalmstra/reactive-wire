import { useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type IsValidConnection,
  type ReactFlowInstance,
} from "@xyflow/react";
import { TYPE_VAR, gridStyle, type Aesthetic } from "../../../shared/theme.js";
import { evaluate, type ViewEdge } from "../../../shared/engine/evaluate.js";
import type { NodeData } from "../../../shared/node-types.js";
import { RWNode } from "./RWNode.js";
import { Palette } from "./Palette.js";
import { ResultsProvider } from "./results-context.js";
import { connectionValid, type RWNodeType } from "./validation.js";
import { replaceInputEdge } from "./wire-replace.js";
import { PALETTE, growVariadic, type NodeTemplate } from "./node-templates.js";
import { boundaryTemplates } from "./boundary-templates.js";
import { MACRO_IN, MACRO_OUT, type MacroDef, type MacroMap } from "../../../shared/macros.js";
import { Icon } from "../components/Icon.js";
import { MacroBoundaryPanel, type BoundaryPin } from "./MacroBoundaryPanel.js";
import type { ValueType } from "../../../shared/theme.js";
import { macroDefFromFlow, macroDefToFlow } from "./macro-editing.js";
import { RWEdge, withRWEdgeData } from "./RWEdge.js";

const nodeTypes = { rw: RWNode };
const edgeTypes = { rw: RWEdge };

/**
 * A full-screen editor for a macro's definition canvas. It hosts the same node canvas as the main
 * editor, seeded with the macro's subgraph and its typed Input/Output boundary nodes. Saving
 * reads the boundary back so the macro's external interface follows its boundary nodes, and
 * recomputes whether the macro is stateful.
 */
export function MacroEditor({
  def,
  macros,
  aesthetic,
  mode,
  themeVars,
  onSave,
  onClose,
}: {
  def: MacroDef;
  macros: MacroMap;
  aesthetic: Aesthetic;
  mode: "dark" | "light";
  themeVars: CSSProperties;
  onSave: (def: MacroDef) => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => macroDefToFlow(def), [def]);
  const [nodes, setNodes, onNodesChange] = useNodesState<RWNodeType>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(def.name);
  const rf = useRef<ReactFlowInstance<RWNodeType, Edge> | null>(null);
  const idc = useRef(0);

  // A no-side-effect memory map: the definition preview shows shapes, not persisted runtime state.
  const memory = useRef({});
  const viewEdges: ViewEdge[] = edges.map((e) => ({
    id: e.id,
    from: { node: e.source, pin: e.sourceHandle ?? "" },
    to: { node: e.target, pin: e.targetHandle ?? "" },
  }));
  const nodeDefs = nodes.map((n) => n.data.def);
  const results = evaluate(nodeDefs, viewEdges, {}, memory.current, Date.now(), {}, macros);
  const displayEdges = useMemo(() => withRWEdgeData(edges, nodes, results), [edges, nodes, results]);

  const onConnect = useCallback(
    (c: Connection) => {
      // Same single-source rule as the main canvas: a new wire into an occupied input replaces it.
      setEdges((eds) => replaceInputEdge(eds, c));
      if (c.target && c.targetHandle) {
        const handle = c.targetHandle;
        setNodes((ns) => ns.map((n) => (n.id === c.target ? { ...n, data: { def: growVariadic(n.data.def, handle) } } : n)));
      }
    },
    [setEdges, setNodes],
  );
  const isValidConnection: IsValidConnection = useCallback((c) => connectionValid(nodes, edges, c as Connection), [nodes, edges]);

  const onConfig = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { def: { ...n.data.def, config: { ...n.data.def.config, ...patch } } } } : n))),
    [setNodes],
  );
  const onSetValue = useCallback(
    (id: string, pin: string, value: unknown) =>
      setNodes((ns) => ns.map((n) => {
        if (n.id !== id) return n;
        const values = { ...(n.data.def.values ?? {}) };
        if (value === undefined) delete values[pin];
        else values[pin] = value;
        return { ...n, data: { def: { ...n.data.def, values: Object.keys(values).length ? values : undefined } } };
      })),
    [setNodes],
  );

  // The macro's editable interface, read live from its boundary nodes. Each macro-in / macro-out
  // node carries one pin; editing renames or retypes that pin in place (its id never changes) so
  // existing inner and parent wires survive.
  const boundaryList = useCallback(
    (boundaryType: string): BoundaryPin[] =>
      nodes
        .filter((n) => n.data.def.type === boundaryType)
        .flatMap((n) => {
          const pins = boundaryType === MACRO_IN ? n.data.def.outputs : n.data.def.inputs;
          return pins.map((p) => ({ nodeId: n.id, pinId: p.id, label: p.label, type: p.type }));
        }),
    [nodes],
  );
  const inputPins = useMemo(() => boundaryList(MACRO_IN), [boundaryList]);
  const outputPins = useMemo(() => boundaryList(MACRO_OUT), [boundaryList]);

  // Patch a boundary pin's label or type without touching its id, keeping wires intact.
  const patchPin = useCallback(
    (nodeId: string, pinId: string, patch: Partial<{ label: string; type: ValueType }>) =>
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== nodeId) return n;
          const def = n.data.def;
          const side = def.type === MACRO_IN ? "outputs" : "inputs";
          const pins = def[side].map((p) => (p.id === pinId ? { ...p, ...patch } : p));
          return { ...n, data: { def: { ...def, [side]: pins } } };
        }),
      ),
    [setNodes],
  );
  const renamePin = useCallback((nodeId: string, pinId: string, label: string) => patchPin(nodeId, pinId, { label }), [patchPin]);
  const retypePin = useCallback((nodeId: string, pinId: string, type: ValueType) => patchPin(nodeId, pinId, { type }), [patchPin]);

  // Remove a boundary node and every wire touching it, dropping that pin from the interface.
  const removePin = useCallback(
    (nodeId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges],
  );

  const addNodeAt = useCallback(
    (t: NodeTemplate, position: { x: number; y: number }) => {
      idc.current += 1;
      const id = `${t.type}-${idc.current}`;
      setNodes((ns) => ns.concat({ id, type: "rw", position, dragHandle: ".rw-drag", data: { def: t.make(id) } }));
    },
    [setNodes],
  );

  // Add a fresh, named single-pin macro-in / macro-out boundary node, giving the macro one more
  // input or output. Its label is the editable pin name; its pin id is unique so wires stay stable.
  const addBoundary = useCallback(
    (boundaryType: string) => {
      const existing = boundaryType === MACRO_IN ? inputPins.length : outputPins.length;
      const label = `${boundaryType === MACRO_IN ? "input" : "output"} ${existing + 1}`;
      idc.current += 1;
      const id = `${boundaryType}-${idc.current}`;
      const x = boundaryType === MACRO_IN ? 60 : 760;
      const y = 120 + existing * 110;
      const def: NodeData =
        boundaryType === MACRO_IN
          ? { id, type: MACRO_IN, title: "Input", subtitle: "Macro input", icon: "io-in", x, y, w: 180, inputs: [], outputs: [{ id, label, type: "num" }] }
          : { id, type: MACRO_OUT, title: "Output", subtitle: "Macro output", icon: "io-out", x, y, w: 180, inputs: [{ id, label, type: "num" }], outputs: [] };
      setNodes((ns) => ns.concat({ id, type: "rw", position: { x, y }, dragHandle: ".rw-drag", data: { def } }));
    },
    [inputPins.length, outputPins.length, setNodes],
  );
  const addNode = useCallback((t: NodeTemplate) => addNodeAt(t, { x: 240 + (idc.current % 6) * 26, y: 160 + (idc.current % 6) * 26 }), [addNodeAt]);
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow");
      const t = [...PALETTE, ...boundaryTemplates].find((x) => x.type === type);
      if (!t || !rf.current) return;
      addNodeAt(t, rf.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNodeAt],
  );

  const save = useCallback(() => {
    onSave(macroDefFromFlow({ original: def, name, nodes, edges, macros }));
  }, [nodes, edges, def, name, macros, onSave]);

  const grid = gridStyle(aesthetic);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-rw-bg text-rw-text text-[13px]" style={themeVars}>
      <header className="h-[52px] flex-none flex items-center gap-[10px] px-[14px] bg-rw-panel border-b border-rw-line select-none">
        <span className="text-rw-accent flex">
          <Icon name="macro" size={18} />
        </span>
        <span className="font-bold text-[13px]">Editing macro</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Macro name"
          className="ml-1 bg-rw-panel2 border border-rw-line rounded-md px-2.5 h-[30px] text-[12px] font-mono outline-none focus:border-rw-accent"
        />
        <span className="text-[11px] text-rw-faint">
          Wire the Inputs / Outputs boundary nodes to define this macro's typed interface.
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="h-[30px] px-3 rounded-md text-[12px] border border-rw-line text-rw-dim hover:bg-rw-panel2 hover:text-rw-text cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="h-8 px-4 rounded-lg bg-rw-accent text-rw-accent-text font-bold text-[12.5px] cursor-pointer hover:brightness-110"
        >
          Save macro
        </button>
      </header>

      <div className="relative flex-1 min-h-0 flex">
        <Palette onAdd={addNode} extra={boundaryTemplates} />
        <div className="relative flex-1 min-h-0" onDrop={onDrop} onDragOver={onDragOver}>
          <ResultsProvider value={{ results, actuating: false, entities: {}, onConfig, onSetValue }}>
            <ReactFlow<RWNodeType, Edge>
              onInit={(inst) => {
                rf.current = inst;
              }}
              nodes={nodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              connectionLineStyle={{ stroke: TYPE_VAR.any, strokeWidth: 2.2 }}
              isValidConnection={isValidConnection}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={mode}
              deleteKeyCode={["Backspace", "Delete"]}
              multiSelectionKeyCode={["Control", "Meta", "Shift"]}
              selectionKeyCode={null}
              selectionOnDrag
              panOnDrag={[1, 2]}
              edgesFocusable
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
              minZoom={0.3}
              maxZoom={2.5}
            >
              <Background
                variant={grid === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                gap={24}
                size={grid === "lines" ? 1 : 2.4}
                lineWidth={1}
                color="var(--rw-grid-dot)"
                bgColor="var(--rw-canvas)"
              />
              <Controls />
            </ReactFlow>
          </ResultsProvider>
        </div>
        <MacroBoundaryPanel
          inputs={inputPins}
          outputs={outputPins}
          onRename={renamePin}
          onRetype={retypePin}
          onRemove={removePin}
          onAddInput={() => addBoundary(MACRO_IN)}
          onAddOutput={() => addBoundary(MACRO_OUT)}
        />
      </div>
    </div>
  );
}
