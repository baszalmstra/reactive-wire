import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../cn.js";
import type { Flow } from "../canvas/flows.js";

/** Stable ARIA ids linking a flow tab to its canvas panel. */
export function flowTabId(flowId: string): string {
  return `rw-flow-tab-${encodeURIComponent(flowId)}`;
}

export function flowPanelId(flowId: string): string {
  return `rw-flow-panel-${encodeURIComponent(flowId)}`;
}

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
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);
  const finishingEditRef = useRef(false);
  const deployed = new Set(deployedIds);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
      return;
    }
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const tab = tabRefs.current.get(pending);
    if (!tab) return;
    pendingFocusRef.current = null;
    tab.focus();
  }, [editing, flows]);

  const beginEdit = (id: string, name: string) => {
    finishingEditRef.current = false;
    setEditing(id);
    setDraft(name);
  };
  const finishEdit = (save: boolean) => {
    if (finishingEditRef.current) return;
    finishingEditRef.current = true;
    if (editing) {
      if (save) {
        const name = draft.trim();
        if (name) onRename(editing, name);
      }
      pendingFocusRef.current = editing;
    }
    setEditing(null);
  };
  const closeAndRestoreFocus = (id: string) => {
    const index = flows.findIndex((flow) => flow.id === id);
    const adjacent = flows[index - 1]?.id ?? flows[index + 1]?.id;
    pendingFocusRef.current = id === activeId ? adjacent ?? null : activeId;
    onClose(id);
  };
  const selectAndFocus = (id: string) => {
    onSelect(id);
    requestAnimationFrame(() => tabRefs.current.get(id)?.focus());
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string, name: string) => {
    const index = flows.findIndex((flow) => flow.id === id);
    if (event.key === "F2") {
      event.preventDefault();
      beginEdit(id, name);
      return;
    }
    let target = -1;
    if (event.key === "ArrowRight") target = (index + 1) % flows.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + flows.length) % flows.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = flows.length - 1;
    if (target >= 0) {
      event.preventDefault();
      selectAndFocus(flows[target]!.id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Flows"
      className="rw-flow-tabs flex-none flex items-stretch gap-1 px-2 h-[34px] bg-rw-panel border-b border-rw-line select-none overflow-x-auto"
    >
      {flows.map((flow) => {
        const active = flow.id === activeId;
        const liveEnabled = deployed.has(flow.id);
        return (
          <div
            key={flow.id}
            title={flow.name}
            className={cn(
              "group flex items-center gap-1.5 px-2 my-1 rounded-md text-[11.5px] transition-colors whitespace-nowrap",
              active
                ? "bg-rw-panel2 text-rw-text border border-rw-line"
                : "text-rw-dim border border-transparent hover:bg-rw-panel2 hover:text-rw-text",
            )}
          >
            {onToggleDeploy && editing !== flow.id && (
              <button
                type="button"
                onClick={() => onToggleDeploy(flow.id, !liveEnabled)}
                aria-label={`${liveEnabled ? "Disable" : "Enable"} ${flow.name} for deployment`}
                title={liveEnabled ? "Included in live deployment" : "Not deployed — click to include"}
                className={cn("rw-flow-live-toggle", liveEnabled && "on")}
              >
                ●
              </button>
            )}
            {editing === flow.id ? (
              <input
                ref={inputRef}
                aria-label={`Rename ${flow.name}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => finishEdit(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishEdit(true);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    finishEdit(false);
                  }
                }}
                className="bg-rw-bg border border-rw-line rounded px-1 py-px text-[11.5px] w-[110px] outline-none"
              />
            ) : (
              <button
                type="button"
                role="tab"
                id={flowTabId(flow.id)}
                aria-controls={flowPanelId(flow.id)}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                ref={(element) => {
                  if (element) tabRefs.current.set(flow.id, element);
                  else tabRefs.current.delete(flow.id);
                }}
                onClick={() => onSelect(flow.id)}
                onDoubleClick={() => beginEdit(flow.id, flow.name)}
                onKeyDown={(event) => onTabKeyDown(event, flow.id, flow.name)}
                className="max-w-[150px] overflow-hidden text-ellipsis cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit"
              >
                {flow.name}
              </button>
            )}
            {flows.length > 1 && editing !== flow.id && (
              <button
                type="button"
                onClick={() => closeAndRestoreFocus(flow.id)}
                aria-label={`Close ${flow.name}`}
                title="Close flow"
                className="rw-flow-close ml-0.5 text-rw-faint hover:text-rw-error opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-[13px] leading-none"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
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
