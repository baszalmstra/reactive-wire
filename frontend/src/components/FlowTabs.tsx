import { useEffect, useRef, useState } from "react";
import { cn } from "../cn.js";
import type { Flow } from "../canvas/flows.js";

/** A tab strip across the top of the canvas, one tab per flow in the document. */
export function FlowTabs({
  flows,
  activeId,
  deployedIds = [],
  onSelect,
  onAdd,
  onRename,
  onClose,
  onToggleDeploy,
}: {
  flows: Pick<Flow, "id" | "name">[];
  activeId: string;
  /** Flow ids included in the server's live deployment set. */
  deployedIds?: string[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onToggleDeploy?: (id: string, enabled: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const deployed = new Set(deployedIds);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const beginEdit = (id: string, name: string) => {
    setEditing(id);
    setDraft(name);
  };
  const commit = () => {
    if (editing) {
      const name = draft.trim();
      if (name) onRename(editing, name);
    }
    setEditing(null);
  };

  return (
    <div className="flex-none flex items-stretch gap-1 px-2 h-[34px] bg-rw-panel border-b border-rw-line select-none overflow-x-auto">
      {flows.map((f) => {
        const active = f.id === activeId;
        const liveEnabled = deployed.has(f.id);
        return (
          <div
            key={f.id}
            onClick={() => onSelect(f.id)}
            onDoubleClick={() => beginEdit(f.id, f.name)}
            title={f.name}
            className={cn(
              "group flex items-center gap-1.5 px-3 my-1 rounded-md text-[11.5px] cursor-pointer transition-colors whitespace-nowrap",
              active
                ? "bg-rw-panel2 text-rw-text border border-rw-line"
                : "text-rw-dim border border-transparent hover:bg-rw-panel2 hover:text-rw-text",
            )}
          >
            {onToggleDeploy && editing !== f.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDeploy(f.id, !liveEnabled);
                }}
                aria-label={`${liveEnabled ? "Disable" : "Enable"} ${f.name} for deployment`}
                title={liveEnabled ? "Included in live deployment" : "Not deployed — click to include"}
                className={cn("rw-flow-live-toggle", liveEnabled && "on")}
              >
                ●
              </button>
            )}
            {editing === f.id ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-rw-bg border border-rw-line rounded px-1 py-px text-[11.5px] w-[110px] outline-none"
              />
            ) : (
              <span className="max-w-[150px] overflow-hidden text-ellipsis">{f.name}</span>
            )}
            {flows.length > 1 && editing !== f.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(f.id);
                }}
                aria-label={`Close ${f.name}`}
                title="Close flow"
                className="ml-0.5 text-rw-faint hover:text-rw-error opacity-0 group-hover:opacity-100 transition-opacity text-[13px] leading-none"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        aria-label="New flow"
        title="New flow"
        className="my-1 px-2.5 rounded-md text-[14px] leading-none text-rw-dim hover:bg-rw-panel2 hover:text-rw-text transition-colors"
      >
        +
      </button>
    </div>
  );
}
