import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EntityMap, EntityState } from "../../../shared/entities.js";
import { rgbToHex } from "../../../shared/value.js";

const inputCls =
  "h-[30px] px-[9px] rounded-[7px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[12px] outline-none w-full focus:border-rw-accent";

/** A small preview of an entity's current state: a color swatch for colored lights, else text. */
function StatePreview({ e }: { e: EntityState }) {
  const rgb = e.attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length >= 3) {
    const hex = rgbToHex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
    return (
      <span className="flex items-center gap-1.5">
        <span className="w-[11px] h-[11px] rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]" style={{ background: hex }} />
        {e.state}
      </span>
    );
  }
  const unit = typeof e.attributes.unit_of_measurement === "string" ? e.attributes.unit_of_measurement : "";
  return <span>{e.state}{unit && ` ${unit}`}</span>;
}

/** A text input with an autocomplete dropdown of known entities, showing each one's live state. */
export function EntityPicker({
  value,
  onChange,
  entities,
  domains,
  autoFocus,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  entities: EntityMap;
  /** When set, only entities in these domains (the part before the dot) are offered. */
  domains?: string[];
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const matches = Object.keys(entities)
    .filter((id) => !domains || domains.length === 0 || domains.includes(id.split(".")[0] ?? ""))
    .filter((id) => id.toLowerCase().includes(q))
    .sort()
    .slice(0, 60);

  // Portal into the themed root so the dropdown escapes scroll/overflow clipping while
  // still inheriting the --rw-* theme variables.
  const root = (typeof document !== "undefined" && document.getElementById("rw-root")) || null;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="domain.entity"
        className={inputCls}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 140)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setOpen(false);
            onSubmit?.();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && rect && matches.length > 0 && root &&
        createPortal(
          <div
            className="fixed z-[200] max-h-[280px] overflow-y-auto rounded-lg border border-rw-line bg-rw-panel shadow-rw"
            style={{ left: rect.left, top: rect.top, width: rect.width }}
          >
            {matches.map((id) => (
              <button
                key={id}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  onChange(id);
                  setOpen(false);
                }}
                className="flex items-center justify-between gap-3 w-full text-left px-2.5 py-1.5 hover:bg-rw-panel2"
              >
                <span className="font-mono text-[11.5px] text-rw-text truncate">{id}</span>
                <span className="font-mono text-[10.5px] text-rw-faint shrink-0 max-w-[45%] truncate">
                  <StatePreview e={entities[id]!} />
                </span>
              </button>
            ))}
          </div>,
          root,
        )}
    </div>
  );
}
