import type { ReactNode } from "react";
import { cn } from "../cn.js";
import { Icon } from "./Icon.js";

const icons: Record<string, ReactNode> = {
  nodes: <Icon name="menu" size={21} />,
  comment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4 9h16" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3" />
    </svg>
  ),
  problems: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  inspect: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M14 4v16" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  ),
};

interface MBtn {
  key: keyof typeof icons;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: number;
}

/** Bottom navigation shown only on small screens, opening the palette/inspector sheets. */
export function MobileBar({
  onNodes,
  onComment,
  onUndo,
  onRedo,
  onProblems,
  onInspect,
  onDelete,
  canUndo,
  canRedo,
  hasSelection,
  problemCount,
}: {
  onNodes: () => void;
  onComment: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onProblems: () => void;
  onInspect: () => void;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  problemCount: number;
}) {
  const buttons: MBtn[] = [
    { key: "nodes", label: "Nodes", onClick: onNodes },
    { key: "comment", label: "Comment", onClick: onComment },
    { key: "undo", label: "Undo", onClick: onUndo, disabled: !canUndo },
    { key: "redo", label: "Redo", onClick: onRedo, disabled: !canRedo },
    { key: "problems", label: "Problems", onClick: onProblems, badge: problemCount > 0 ? problemCount : undefined },
    { key: "inspect", label: "Inspect", onClick: onInspect, active: hasSelection },
    { key: "delete", label: "Delete", onClick: onDelete, disabled: !hasSelection },
  ];
  return (
    <nav className="rw-mobilebar" aria-label="Canvas actions">
      {buttons.map((b) => (
        <button key={b.key} className={cn("rw-mbtn", b.active && "active", b.key === "delete" && "danger")} onClick={b.onClick} disabled={b.disabled} aria-label={b.label}>
          <span className="rw-mbtn-ico">{icons[b.key]}</span>
          <span className="rw-mbtn-label">{b.label}</span>
          {b.badge != null && <span className="rw-mbtn-badge">{b.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
