import { useCallback, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { nodeGeom } from "../../../shared/node-types.js";
import { editorNodeWithInitialSize } from "./editor-document.js";
import type { EditorNode } from "../canvas/flows.js";
import type { RWNodeType } from "../canvas/validation.js";
import type { CommentOps } from "../canvas/comments-context.js";
import {
  COMMENT_COLOR_KEYS,
  nodeCenterInside,
  resizeFrame,
  type CommentColor,
  type CommentData,
  type CommentNodeType,
  type ResizeDir,
} from "../canvas/comments.js";
import type { ToastMessage } from "../components/Toast.js";

const isRWNode = (n: EditorNode): n is RWNodeType => n.type === "rw";
const isCommentNode = (n: EditorNode): n is CommentNodeType => n.type === "comment";

export interface CommentFramesControls {
  commentOps: CommentOps;
  addComment: () => void;
  onNodeDragStart: (e: unknown, node: EditorNode) => void;
  onNodeDrag: (e: unknown, node: EditorNode) => void;
  onNodeDragStop: () => void;
}

export function useCommentFrames(options: {
  nodesRef: MutableRefObject<EditorNode[]>;
  setNodes: Dispatch<SetStateAction<EditorNode[]>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  pushHistory: () => void;
  selected: string | null;
  showToast: (text: string, kind: ToastMessage["kind"]) => void;
  rf: MutableRefObject<ReactFlowInstance<EditorNode, Edge> | null>;
  clientId: MutableRefObject<string>;
}): CommentFramesControls {
  const { nodesRef, setNodes, setSelected, pushHistory, selected, showToast, rf, clientId } = options;

  const updateComment = useCallback(
    (id: string, patch: Partial<CommentData>) => {
      pushHistory();
      setNodes((ns) => ns.map((n) => (n.id === id && isCommentNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes, pushHistory],
  );
  const deleteComment = useCallback(
    (id: string) => {
      pushHistory();
      setNodes((ns) => ns.filter((n) => n.id !== id));
    },
    [setNodes, pushHistory],
  );

  // A resize handle drags a frame edge or corner in flow space; the matching opposite edge stays put.
  const resizeState = useRef<{ id: string; dir: ResizeDir; start: { x: number; y: number; w: number; h: number }; px: number; py: number } | null>(null);
  const onResizeStart = useCallback(
    (id: string, dir: ResizeDir, e: React.PointerEvent) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || !isCommentNode(node)) return;
      pushHistory();
      resizeState.current = { id, dir, start: { x: node.position.x, y: node.position.y, w: node.data.w, h: node.data.h }, px: e.clientX, py: e.clientY };
      const zoom = rf.current?.getZoom() ?? 1;
      const onMove = (ev: PointerEvent) => {
        const s = resizeState.current;
        if (!s) return;
        const dx = (ev.clientX - s.px) / zoom;
        const dy = (ev.clientY - s.py) / zoom;
        const r = resizeFrame(s.start, s.dir, dx, dy);
        setNodes((ns) => ns.map((n) => (n.id === s.id && isCommentNode(n) ? { ...n, position: { x: r.x, y: r.y }, data: { ...n.data, w: r.w, h: r.h } } : n)));
      };
      const onUp = () => {
        resizeState.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [nodesRef, rf, setNodes, pushHistory],
  );

  const commentOps: CommentOps = useMemo(
    () => ({
      onRename: (id, title) => updateComment(id, { title }),
      onRecolor: (id, color: CommentColor) => updateComment(id, { color }),
      onDelete: deleteComment,
      onResizeStart,
    }),
    [updateComment, deleteComment, onResizeStart],
  );

  // Add a frame around the selected node (if any), else at the centre of the current view.
  const cmtc = useRef(0);
  const addComment = useCallback(() => {
    pushHistory();
    cmtc.current += 1;
    const id = `comment-${clientId.current}-${cmtc.current}`;
    const sel = nodesRef.current.find((n) => n.id === selected && isRWNode(n)) as RWNodeType | undefined;
    let position: { x: number; y: number };
    let data: CommentData;
    const color = COMMENT_COLOR_KEYS[cmtc.current % COMMENT_COLOR_KEYS.length];
    if (sel) {
      const g = nodeGeom(sel.data.def);
      const pad = 38;
      position = { x: sel.position.x - pad, y: sel.position.y - pad - 8 };
      data = { title: "Comment", color, w: g.w + pad * 2, h: g.h + pad * 2 + 8 };
    } else {
      const center = rf.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 0, y: 0 };
      position = { x: Math.round(center.x - 170), y: Math.round(center.y - 110) };
      data = { title: "Comment", color, w: 340, h: 220 };
    }
    // A low z-index keeps the frame behind the graph nodes it groups.
    setNodes((ns) => ns.concat(editorNodeWithInitialSize({ id, type: "comment", position, dragHandle: ".rw-drag", zIndex: 0, data } as EditorNode)));
    setSelected(id);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    showToast("Comment added — drag its bar to move the group", "info");
  }, [selected, setNodes, setSelected, showToast, pushHistory, nodesRef, rf, clientId]);

  // Dragging a comment bar carries the nodes whose centre sits inside the frame at drag start.
  const dragCarry = useRef<{ id: string; sx: number; sy: number; members: { id: string; x: number; y: number }[] } | null>(null);
  const onNodeDragStart = useCallback(
    (_e: unknown, node: EditorNode) => {
      // One checkpoint for the whole drag gesture.
      pushHistory();
      if (!isCommentNode(node)) return;
      const frame = { x: node.position.x, y: node.position.y, w: node.data.w, h: node.data.h };
      const members = nodesRef.current
        .filter((n): n is RWNodeType => isRWNode(n) && nodeCenterInside(n, frame))
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
      dragCarry.current = { id: node.id, sx: node.position.x, sy: node.position.y, members };
    },
    [pushHistory, nodesRef],
  );
  const onNodeDrag = useCallback(
    (_e: unknown, node: EditorNode) => {
      const carry = dragCarry.current;
      if (!carry || carry.id !== node.id) return;
      const dx = node.position.x - carry.sx;
      const dy = node.position.y - carry.sy;
      const byId = new Map(carry.members.map((m) => [m.id, m]));
      setNodes((ns) => ns.map((n) => {
        const m = byId.get(n.id);
        return m ? { ...n, position: { x: m.x + dx, y: m.y + dy } } : n;
      }));
    },
    [setNodes],
  );
  const onNodeDragStop = useCallback(() => {
    dragCarry.current = null;
  }, []);

  return { commentOps, addComment, onNodeDragStart, onNodeDrag, onNodeDragStop };
}
