import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon.js";
import { Tooltip } from "../components/Tooltip.js";
import { PALETTE, describeNode, type NodeTemplate } from "./node-templates.js";

/**
 * Left sidebar: searchable list of node templates, grouped by category. Click to add. `extra`
 * templates (e.g. a macro definition's boundary nodes) are merged into the catalog; `children`
 * render below it (the main editor uses this for the Macros section).
 */
export function Palette({
  onAdd,
  extra = [],
  mobileSettings,
  children,
}: {
  onAdd: (t: NodeTemplate) => void;
  extra?: NodeTemplate[];
  /** Controls shown at the top of the mobile palette drawer. */
  mobileSettings?: ReactNode;
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const all = [...PALETTE, ...extra];
  const matches = q ? all.filter((t) => t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) : all;

  const categories: string[] = [];
  for (const t of matches) if (!categories.includes(t.category)) categories.push(t.category);

  return (
    <aside className="w-[244px] flex-none bg-rw-panel border-r border-rw-line flex flex-col min-h-0">
      <div className="flex items-center gap-2 mx-[14px] mt-3 mb-1.5 px-[10px] h-[34px] rounded-lg bg-rw-panel2 border border-rw-line">
        <span className="text-rw-faint flex">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="flex-1 bg-transparent text-rw-text text-[12px] outline-none placeholder:text-rw-faint"
        />
      </div>

      {mobileSettings}

      <div className="rw-palette-scroll flex-1 overflow-y-auto py-1 pb-5">
        {categories.map((cat) => (
          <div key={cat} className="px-[10px]">
            <div className="text-[10.5px] text-rw-faint font-semibold px-1.5 pt-1.5 pb-[3px]">{cat}</div>
            <div className="flex flex-col gap-0.5">
              {matches
                .filter((t) => t.category === cat)
                .map((t) => {
                  const desc = describeNode(t.type);
                  return (
                    <Tooltip
                      key={t.type + t.label}
                      content={
                        <>
                          <div className="font-mono text-[11px] text-rw-text">{t.label}</div>
                          <div className="mt-0.5 text-rw-dim">{desc ?? "Drag onto the canvas (or click to add)."}</div>
                        </>
                      }
                    >
                      <button
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/reactflow", t.type);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => onAdd(t)}
                        className="group flex items-center gap-[9px] w-full px-2 py-1.5 rounded-[7px] text-rw-text text-[12px] text-left cursor-grab active:cursor-grabbing hover:bg-rw-panel2"
                      >
                        <span className="text-rw-dim flex w-4">
                          <Icon name={t.icon} size={15} />
                        </span>
                        <span className="flex-1 font-mono text-[11px]">{t.label}</span>
                        <span className="text-rw-faint text-[15px] opacity-0 group-hover:opacity-100">+</span>
                      </button>
                    </Tooltip>
                  );
                })}
            </div>
          </div>
        ))}
        {matches.length === 0 && <div className="px-4 py-3 text-[11.5px] text-rw-faint italic">No nodes match “{query}”.</div>}
        {children}
      </div>
    </aside>
  );
}
