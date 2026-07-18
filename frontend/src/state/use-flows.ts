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
      const target = flows.find((flow) => flow.id === id);
      if (!target) return;
      // Capture before queueing any store clears. React may render the node store update before it
      // runs the flow-state updater, so reading refs from inside that updater can otherwise stash
      // the newly loaded/cleared canvas instead of the flow the user is leaving.
      const activeNodes = nodesRef.current;
      const activeEdges = edgesRef.current;
      setFlows((fs) => fs.map((flow) => (
        flow.id === activeFlowId ? { ...flow, nodes: activeNodes, edges: activeEdges } : flow
      )));
      setNodes(target.nodes);
      setEdges(target.edges);
      setActiveFlowId(id);
      setSelected(null);
      setSelectedIds([]);
      setPast([]);
      setFuture([]);
    },
    [flows, activeFlowId, nodesRef, edgesRef, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture],
  );

  const addFlow = useCallback(() => {
    const f = emptyFlow(`Flow ${flows.length + 1}`);
    const activeNodes = nodesRef.current;
    const activeEdges = edgesRef.current;
    setFlows((fs) => fs
      .map((flow) => (flow.id === activeFlowId ? { ...flow, nodes: activeNodes, edges: activeEdges } : flow))
      .concat(f));
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
      if (flows.length <= 1) return;
      const idx = flows.findIndex((flow) => flow.id === id);
      if (idx < 0) return;
      const rest = flows.filter((flow) => flow.id !== id);
      delete memories.current[id];
      setFlows((fs) => fs.filter((flow) => flow.id !== id));
      // When closing the active flow, fall to a neighbour and load its store. Keep these state
      // changes outside the functional updater so the updater stays pure under Strict Mode.
      if (id === activeFlowId) {
        const next = rest[Math.max(0, idx - 1)];
        if (!next) return;
        setNodes(next.nodes);
        setEdges(next.edges);
        setActiveFlowId(next.id);
        setSelected(null);
        setSelectedIds([]);
        setPast([]);
        setFuture([]);
      }
    },
    [flows, activeFlowId, memories, setNodes, setEdges, setSelected, setSelectedIds, setPast, setFuture],
  );

  return { flows, setFlows, activeFlowId, setActiveFlowId, flowTabs, switchFlow, addFlow, renameFlow, closeFlow };
}
