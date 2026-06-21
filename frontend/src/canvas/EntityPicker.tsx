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

/** A text input with a keyboard/click selectable list of known entities, showing each one's live state. */
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
  const q = value.trim().toLowerCase();
  const matches = Object.keys(entities)
    .filter((id) => !domains || domains.length === 0 || domains.includes(id.split(".")[0] ?? ""))
    .filter((id) => id.toLowerCase().includes(q))
    .sort()
    .slice(0, 60);

  const choose = (id: string) => {
    if (!id) return;
    onChange(id);
    setOpen(false);
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
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setOpen(false);
            onSubmit?.();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 && (
        <select
          size={Math.min(6, matches.length)}
          value={matches.includes(value) ? value : ""}
          onPointerDown={(ev) => ev.stopPropagation()}
          onMouseDown={(ev) => ev.stopPropagation()}
          onChange={(e) => choose(e.target.value)}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[230] max-h-[280px] rounded-lg border border-rw-line bg-rw-panel text-rw-text shadow-rw font-mono text-[11.5px] outline-none"
        >
          {!matches.includes(value) && <option value="" disabled>Choose entity…</option>}
          {matches.map((id) => (
            <option key={id} value={id}>{id} — {statePreview(entities[id]!)}</option>
          ))}
        </select>
      )}
    </div>
  );
}
