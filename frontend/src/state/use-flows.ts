import { useCallback, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Edge } from "@xyflow/react";
import type { Memory } from "../../../shared/engine/evaluate.js";
import { emptyFlow, type EditorNode, type Flow } from "../canvas/flows.js";
import { initialNodes, initialEdges } from "../example/rf-graph.js";
import type { CanvasSnapshot } from "./use-undo-redo.js";

export interface FlowsControls {
  flows: Flow[];
  setFlows: Dispatch<SetStateAction<Flow[]>>;
  activeFlowId: string;
  setActiveFlowId: Dispatch<SetStateAction<string>>;
  flowTabs: { id: string; name: string }[];
  switchFlow: (id: string) => void;
  addFlow: () => void;
  renameFlow: (id: string, name: string) => void;
  closeFlow: (id: string) => void;
}

export function useFlows(options: {
  nodesRef: MutableRefObject<EditorNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<EditorNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setPast: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  setFuture: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  memories: MutableRefObject<Record<string, Memory>>;
}): FlowsControls {
  const { nodesRef, edgesRef, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture, memories } = options;
  // The document holds several independent flows; the live node/edge stores in App are the active
  // flow's working copy. Switching tabs stashes the working copy back into its flow and loads the
  // next one. Inactive flows keep their nodes/edges here.
  const [flows, setFlows] = useState<Flow[]>(() => [{ ...emptyFlow("Flow 1"), nodes: initialNodes, edges: initialEdges }]);
  const [activeFlowId, setActiveFlowId] = useState(() => flows[0]!.id);
  const flowTabs = useMemo(() => flows.map((f) => ({ id: f.id, name: f.name })), [flows]);

  // Switch to another flow: stash the active working store into its flow entry, then load the
  // target flow's nodes and edges into the working store. Undo history is per session, not per
  // flow, so it is cleared on switch to avoid restoring a snapshot into the wrong flow.
  const switchFlow = useCallback(
    (id: string) => {
      if (id === activeFlowId) return;
      setFlows((fs) => {
        const target = fs.find((f) => f.id === id);
        if (!target) return fs;
        const stashed = fs.map((f) => (f.id === activeFlowId ? { ...f, nodes: nodesRef.current, edges: edgesRef.current } : f));
        setNodes(target.nodes);
        setEdges(target.edges);
        return stashed;
      });
      setActiveFlowId(id);
      setSelected(null);
      setSelectedIds([]);
      setPast([]);
      setFuture([]);
    },
    [activeFlowId, nodesRef, edgesRef, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture],
  );

  const addFlow = useCallback(() => {
    const f = emptyFlow(`Flow ${flows.length + 1}`);
    setFlows((fs) => fs.map((x) => (x.id === activeFlowId ? { ...x, nodes: nodesRef.current, edges: edgesRef.current } : x)).concat(f));
    setNodes([]);
    setEdges([]);
    setActiveFlowId(f.id);
    setSelected(null);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
  }, [flows.length, activeFlowId, nodesRef, edgesRef, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture]);

  const renameFlow = useCallback((id: string, name: string) => {
    setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const closeFlow = useCallback(
    (id: string) => {
      setFlows((fs) => {
        if (fs.length <= 1) return fs;
        const idx = fs.findIndex((f) => f.id === id);
        const rest = fs.filter((f) => f.id !== id);
        delete memories.current[id];
        // When closing the active flow, fall to a neighbour and load its store.
        if (id === activeFlowId) {
          const next = rest[Math.max(0, idx - 1)];
          if (!next) return rest;
          setNodes(next.nodes);
          setEdges(next.edges);
          setActiveFlowId(next.id);
          setSelected(null);
          setSelectedIds([]);
          setPast([]);
          setFuture([]);
        }
        return rest;
      });
    },
    [activeFlowId, memories, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture],
  );

  return { flows, setFlows, activeFlowId, setActiveFlowId, flowTabs, switchFlow, addFlow, renameFlow, closeFlow };
}
