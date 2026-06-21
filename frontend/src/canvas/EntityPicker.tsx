import { useState } from "react";
import type { EntityMap, EntityState } from "../../../shared/entities.js";
import { rgbToHex } from "../../../shared/value.js";

const inputCls =
  "h-[30px] px-[9px] rounded-[7px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[12px] outline-none w-full focus:border-rw-accent";

/** Text preview of an entity's current state; includes light color when available. */
function statePreview(e: EntityState): string {
  const rgb = e.attributes.rgb_color;
  const unit = typeof e.attributes.unit_of_measurement === "string" ? e.attributes.unit_of_measurement : "";
  const color = Array.isArray(rgb) && rgb.length >= 3 ? ` ${rgbToHex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]))}` : "";
  return `${e.state}${unit ? ` ${unit}` : ""}${color}`;
}

/** A styled text input with a keyboard/click selectable list of known entities and live state. */
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
  const [open, setOpen] = useState(!!autoFocus);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const matches = Object.keys(entities)
    .filter((id) => !domains || domains.length === 0 || domains.includes(id.split(".")[0] ?? ""))
    .filter((id) => id.toLowerCase().includes(q))
    .sort()
    .slice(0, 80);

  const choose = (id: string) => {
    if (!id) return;
    onChange(id);
    setOpen(false);
    setActive(0);
  };

  const chooseFromPointer = (id: string, ev: React.PointerEvent | React.MouseEvent) => {
    // Select before the input blur/React Flow/backdrop handlers can close or steal the event.
    ev.preventDefault();
    ev.stopPropagation();
    choose(id);
  };

  return (
    <div className="relative z-[220]">
      <input
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="domain.entity"
        className={inputCls}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && matches[active]) choose(matches[active]);
            else onSubmit?.();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          role="listbox"
          aria-label="Home Assistant entities"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[230] max-h-[280px] overflow-auto rounded-lg border border-rw-line bg-rw-panel py-1 shadow-rw ring-1 ring-black/20"
          onPointerDown={(ev) => ev.stopPropagation()}
          onMouseDown={(ev) => ev.stopPropagation()}
        >
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-[11.5px] text-rw-faint">No matching entities</div>
          ) : (
            matches.map((id, index) => {
              const selected = id === value;
              const highlighted = index === active;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-entity-id={id}
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={(ev) => chooseFromPointer(id, ev)}
                  onMouseDown={(ev) => chooseFromPointer(id, ev)}
                  onClick={(ev) => chooseFromPointer(id, ev)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-[11.5px] outline-none transition-colors ${highlighted || selected ? "bg-rw-accent/15 text-rw-text" : "text-rw-dim hover:bg-rw-panel2 hover:text-rw-text"}`}
                >
                  <span className="min-w-0 truncate text-rw-text">{id}</span>
                  <span className="shrink-0 text-rw-faint">{statePreview(entities[id]!)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
