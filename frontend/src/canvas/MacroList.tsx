import { useRef } from "react";
import { Icon } from "../components/Icon.js";
import { MemBadge } from "../components/Badges.js";
import type { MacroDef, MacroMap } from "../../../shared/macros.js";
import { exportMacro, importBundle, parseBundle } from "./macro-io.js";

/**
 * The Macros section of the palette: every defined macro, each draggable onto the canvas as a new
 * placement, with edit / export controls, plus an Import action. Stateful macros carry the memory
 * badge so the graph stays honest about which placements hold state.
 */
export function MacroList({
  macros,
  onPlace,
  onEdit,
  onDelete,
  onImport,
}: {
  macros: MacroMap;
  onPlace: (def: MacroDef) => void;
  onEdit: (def: MacroDef) => void;
  onDelete: (id: string) => void;
  onImport: (macros: MacroMap, rootId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const list = Object.values(macros);

  const doExport = (def: MacroDef) => {
    const bundle = exportMacro(def.id, macros);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.name.replace(/\s+/g, "-").toLowerCase() || "macro"}.rwmacro.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    const bundle = parseBundle(await file.text());
    if (!bundle) return;
    const { macros: next, rootId } = importBundle(bundle, macros);
    onImport(next, rootId);
  };

  return (
    <div className="px-[10px] mt-1">
      <div className="flex items-center justify-between px-1.5 pt-1.5 pb-[3px]">
        <span className="text-[10.5px] text-rw-faint font-semibold">Macros</span>
        <button
          onClick={() => fileRef.current?.click()}
          title="Import a macro from JSON"
          className="text-[10px] text-rw-dim hover:text-rw-text border border-rw-line rounded px-1.5 py-px cursor-pointer"
        >
          import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {list.length === 0 ? (
        <p className="px-1.5 py-1 text-[10.5px] text-rw-faint italic leading-relaxed">
          Select nodes and choose “Group into macro” to make a reusable node.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {list.map((def) => (
            <div
              key={def.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/reactflow-macro", def.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onPlace(def)}
              title="Drag onto the canvas (or click to add)"
              className="group flex items-center gap-[9px] w-full px-2 py-1.5 rounded-[7px] text-rw-text text-[12px] cursor-grab active:cursor-grabbing hover:bg-rw-panel2"
            >
              <span className="text-rw-dim flex w-4">
                <Icon name="macro" size={15} />
              </span>
              <span className="flex-1 font-mono text-[11px] truncate">{def.name}</span>
              {def.stateful && <MemBadge />}
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(def); }}
                title="Edit definition"
                className="text-rw-faint hover:text-rw-text text-[12px] opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                ✎
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); doExport(def); }}
                title="Export as JSON"
                className="text-rw-faint hover:text-rw-text text-[13px] opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                ↧
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(def.id); }}
                title="Delete macro"
                className="text-rw-faint hover:text-rw-error text-[12px] opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
