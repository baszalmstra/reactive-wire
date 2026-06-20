import type { Node } from "@xyflow/react";
import { nodeGeom } from "../../../shared/node-types.js";
import type { RWNodeType } from "./validation.js";

/** A labelled, resizable frame on the canvas that groups nodes visually. Annotation only. */
export type CommentData = {
  title: string;
  color: CommentColor;
  w: number;
  h: number;
} & Record<string, unknown>;

export type CommentNodeType = Node<CommentData, "comment">;

export type CommentColor = "slate" | "blue" | "teal" | "green" | "amber" | "violet" | "rose";

/** Frame tints, expressed in OKLCH so they read consistently across light and dark themes. */
export const COMMENT_COLORS: Record<CommentColor, string> = {
  slate: "oklch(0.66 0.02 260)",
  blue: "oklch(0.68 0.13 252)",
  teal: "oklch(0.72 0.11 182)",
  green: "oklch(0.72 0.12 150)",
  amber: "oklch(0.80 0.13 78)",
  violet: "oklch(0.69 0.15 318)",
  rose: "oklch(0.69 0.16 14)",
};

export const COMMENT_COLOR_KEYS = Object.keys(COMMENT_COLORS) as CommentColor[];

/** A node belongs to a comment when its centre point sits inside the comment rectangle. */
export function nodeCenterInside(node: RWNodeType, frame: { x: number; y: number; w: number; h: number }): boolean {
  const g = nodeGeom(node.data.def);
  const cx = node.position.x + g.w / 2;
  const cy = node.position.y + g.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h;
}

export type ResizeDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RESIZE_DIRS: ResizeDir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const COMMENT_MIN_W = 140;
export const COMMENT_MIN_H = 90;

/** Apply a resize in one of eight directions to a frame, keeping it above the minimum size. */
export function resizeFrame(
  start: { x: number; y: number; w: number; h: number },
  dir: ResizeDir,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = start;
  if (dir.includes("e")) w = Math.max(COMMENT_MIN_W, start.w + dx);
  if (dir.includes("s")) h = Math.max(COMMENT_MIN_H, start.h + dy);
  if (dir.includes("w")) {
    w = Math.max(COMMENT_MIN_W, start.w - dx);
    x = start.x + (start.w - w);
  }
  if (dir.includes("n")) {
    h = Math.max(COMMENT_MIN_H, start.h - dy);
    y = start.y + (start.h - h);
  }
  return { x, y, w, h };
}
