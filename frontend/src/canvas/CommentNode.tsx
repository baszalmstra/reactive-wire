import { useEffect, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "../cn.js";
import {
  COMMENT_COLORS,
  COMMENT_COLOR_KEYS,
  RESIZE_DIRS,
  type CommentColor,
  type CommentNodeType,
} from "./comments.js";
import { useCommentOps } from "./comments-context.js";

/**
 * An Unreal-style comment frame: a tinted, resizable box with a draggable, editable title bar.
 * It groups the nodes that sit inside it visually and carries them when its bar is dragged.
 * The frame is purely an annotation — it has no effect on evaluation.
 */
export function CommentNode({ id, data, selected }: NodeProps<CommentNodeType>) {
  const { onRename, onRecolor, onDelete, onResizeStart } = useCommentOps();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);
  useEffect(() => setDraft(data.title), [data.title]);

  const cc = COMMENT_COLORS[data.color] ?? COMMENT_COLORS.slate;
  const commit = () => {
    setEditing(false);
    const v = draft.trim() || "Comment";
    if (v !== data.title) onRename(id, v);
  };

  return (
    <div
      className={cn("rw-comment", selected && "sel")}
      style={{ width: data.w, height: data.h, ["--cc" as string]: cc }}
    >
      <div className="rw-comment-body" />
      <div
        className="rw-comment-bar rw-drag"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <span className="rw-comment-dot" />
        {editing ? (
          <input
            ref={inputRef}
            className="rw-comment-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(data.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="rw-comment-title" title="Double-click to rename">
            {data.title}
          </span>
        )}
        {selected && (
          <div className="rw-comment-tools nodrag" onPointerDown={(e) => e.stopPropagation()}>
            <div className="rw-comment-swatches">
              {COMMENT_COLOR_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={cn("rw-comment-sw", data.color === k && "on")}
                  title={`${k} comment color`}
                  aria-label={`Set comment color ${k}`}
                  aria-pressed={data.color === k}
                  onClick={() => onRecolor(id, k as CommentColor)}
                >
                  <span aria-hidden="true" style={{ background: COMMENT_COLORS[k] }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rw-comment-del"
              title="Delete comment (keeps nodes)"
              aria-label="Delete comment"
              onClick={() => onDelete(id)}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      {selected &&
        RESIZE_DIRS.map((dir) => (
          <span
            key={dir}
            className={`rw-ch rw-ch-${dir} nodrag`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizeStart(id, dir, e);
            }}
          />
        ))}
    </div>
  );
}
