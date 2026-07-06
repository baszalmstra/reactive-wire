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

  // Read the live canvas into a standalone snapshot. Copies the arrays so the entry keeps the
  // membership it had at read time; the node/edge objects are treated as immutable elsewhere.
  const snapshot = useCallback(
    (): CanvasSnapshot => ({ nodes: [...nodesRef.current], edges: [...edgesRef.current] }),
    [nodesRef, edgesRef],
  );

  // Record a checkpoint of the current canvas before a mutation, clearing the redo branch. The
  // snapshot is taken eagerly here, while the refs still point at the pre-mutation arrays; a
  // setPast updater would instead run during the mutating render, after nodesRef/edgesRef have
  // been reassigned to the post-mutation arrays, and would capture the wrong state.
  const pushHistory = useCallback(() => {
    const before = snapshot();
    setPast((p) => [...p.slice(-40), before]);
    setFuture([]);
  }, [snapshot]);
  const undo = useCallback(() => {
    const current = snapshot();
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1]!;
      setFuture((f) => [current, ...f]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      return p.slice(0, -1);
    });
  }, [snapshot, setNodes, setEdges]);
  const redo = useCallback(() => {
    const current = snapshot();
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0]!;
      setPast((p) => [...p, current]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(1);
    });
  }, [snapshot, setNodes, setEdges]);

  // React Flow's own Delete/Backspace handler removes selected nodes and edges by feeding "remove"
  // changes into the stores. Checkpoint the canvas here, before those changes land, so the deletion
  // is undoable. Returning true lets the deletion proceed unchanged.
  const onBeforeDelete = useCallback(async () => {
    pushHistory();
    return true;
  }, [pushHistory]);

  return { canUndo, canRedo, pushHistory, undo, redo, onBeforeDelete, setPast, setFuture };
}
