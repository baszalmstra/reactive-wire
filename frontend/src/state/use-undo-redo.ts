import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Edge } from "@xyflow/react";
import type { EditorNode } from "../canvas/flows.js";

// Undo/redo over canvas snapshots. A checkpoint captures nodes + edges before a mutation.
export type CanvasSnapshot = { nodes: EditorNode[]; edges: Edge[] };

export interface UndoRedoControls {
  canUndo: boolean;
  canRedo: boolean;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  onBeforeDelete: () => Promise<boolean>;
  setPast: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  setFuture: Dispatch<SetStateAction<CanvasSnapshot[]>>;
}

export function useUndoRedo(options: {
  nodesRef: MutableRefObject<EditorNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<EditorNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}): UndoRedoControls {
  const { nodesRef, edgesRef, setNodes, setEdges } = options;
  const [past, setPast] = useState<CanvasSnapshot[]>([]);
  const [future, setFuture] = useState<CanvasSnapshot[]>([]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Record a checkpoint of the current canvas before a mutation, clearing the redo branch.
  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-40), { nodes: nodesRef.current, edges: edgesRef.current }]);
    setFuture([]);
  }, [nodesRef, edgesRef]);
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [{ nodes: nodesRef.current, edges: edgesRef.current }, ...f]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      return p.slice(0, -1);
    });
  }, [nodesRef, edgesRef, setNodes, setEdges]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, { nodes: nodesRef.current, edges: edgesRef.current }]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(1);
    });
  }, [nodesRef, edgesRef, setNodes, setEdges]);

  // React Flow's own Delete/Backspace handler removes selected nodes and edges by feeding "remove"
  // changes into the stores. Checkpoint the canvas here, before those changes land, so the deletion
  // is undoable. Returning true lets the deletion proceed unchanged.
  const onBeforeDelete = useCallback(async () => {
    pushHistory();
    return true;
  }, [pushHistory]);

  return { canUndo, canRedo, pushHistory, undo, redo, onBeforeDelete, setPast, setFuture };
}
