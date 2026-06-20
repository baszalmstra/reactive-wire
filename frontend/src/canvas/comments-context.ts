import { createContext, useContext } from "react";
import type { CommentColor, ResizeDir } from "./comments.js";

/** Operations a comment frame triggers, threaded through context so the node stays presentational. */
export interface CommentOps {
  onRename: (id: string, title: string) => void;
  onRecolor: (id: string, color: CommentColor) => void;
  onDelete: (id: string) => void;
  /** A resize gesture on one of the eight handles; coordinates are in flow space. */
  onResizeStart: (id: string, dir: ResizeDir, e: React.PointerEvent) => void;
}

export const CommentCtx = createContext<CommentOps | null>(null);
export const useCommentOps = (): CommentOps => {
  const ctx = useContext(CommentCtx);
  if (!ctx) throw new Error("CommentNode must be rendered inside a CommentCtx provider");
  return ctx;
};
