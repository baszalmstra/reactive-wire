import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
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
  const [past, setPastState] = useState<CanvasSnapshot[]>([]);
  const [future, setFutureState] = useState<CanvasSnapshot[]>([]);
  // History is also read from keyboard handlers. Keep the next entries in refs before React
  // schedules a render so a Ctrl+Y immediately after Ctrl+Z cannot observe an empty redo branch.
  const pastRef = useRef<CanvasSnapshot[]>([]);
  const futureRef = useRef<CanvasSnapshot[]>([]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const setPast = useCallback<Dispatch<SetStateAction<CanvasSnapshot[]>>>((next) => {
    const value = typeof next === "function" ? next(pastRef.current) : next;
    pastRef.current = value;
    setPastState(value);
  }, []);
  const setFuture = useCallback<Dispatch<SetStateAction<CanvasSnapshot[]>>>((next) => {
    const value = typeof next === "function" ? next(futureRef.current) : next;
    futureRef.current = value;
    setFutureState(value);
  }, []);

  const commitHistory = useCallback((nextPast: CanvasSnapshot[], nextFuture: CanvasSnapshot[], restore?: CanvasSnapshot) => {
    pastRef.current = nextPast;
    futureRef.current = nextFuture;
    flushSync(() => {
      setPastState(nextPast);
      setFutureState(nextFuture);
      if (restore) {
        setNodes(restore.nodes);
        setEdges(restore.edges);
      }
    });
  }, [setNodes, setEdges]);

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
    // Commit the checkpoint before the mutating event continues. React Flow's onBeforeDelete may
    // remove nodes/edges immediately after this callback; without a synchronous commit, a very fast
    // Ctrl+Z can observe the pre-checkpoint history and undo the wrong edit.
    commitHistory([...pastRef.current.slice(-40), before], []);
  }, [commitHistory, snapshot]);
  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    const current = snapshot();
    commitHistory(pastRef.current.slice(0, -1), [current, ...futureRef.current], previous);
  }, [commitHistory, snapshot]);
  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    const current = snapshot();
    commitHistory([...pastRef.current, current], futureRef.current.slice(1), next);
  }, [commitHistory, snapshot]);

  // React Flow's own Delete/Backspace handler removes selected nodes and edges by feeding "remove"
  // changes into the stores. Checkpoint the canvas here, before those changes land, so the deletion
  // is undoable. Returning true lets the deletion proceed unchanged.
  const onBeforeDelete = useCallback(async () => {
    pushHistory();
    return true;
  }, [pushHistory]);

  return { canUndo, canRedo, pushHistory, undo, redo, onBeforeDelete, setPast, setFuture };
}
