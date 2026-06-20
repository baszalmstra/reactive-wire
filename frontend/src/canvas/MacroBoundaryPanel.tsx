import { TYPE_VAR, TYPE_LABEL, type ValueType } from "../../../shared/theme.js";
import { Icon } from "../components/Icon.js";

/** One editable boundary pin, surfaced from a macro-in / macro-out boundary node. */
export interface BoundaryPin {
  /** The boundary node that carries this pin. */
  nodeId: string;
  /** The pin id (stable across renames so wires survive). */
  pinId: string;
  label: string;
  type: ValueType;
}

const TYPES: ValueType[] = ["bool", "num", "str", "color", "duration", "datetime", "any"];

function PinRow({
  pin,
  onRename,
  onRetype,
  onRemove,
}: {
  pin: BoundaryPin;
  onRename: (label: string) => void;
  onRetype: (type: ValueType) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[9px] h-[9px] rounded-full flex-none" style={{ background: TYPE_VAR[pin.type] }} />
      <input
        value={pin.label}
        onChange={(e) => onRename(e.target.value)}
        placeholder="name"
        className="flex-1 min-w-0 bg-rw-panel2 border border-rw-line rounded-[6px] px-2 h-[26px] text-[11.5px] font-mono outline-none focus:border-rw-accent"
      />
      <select
        value={pin.type}
        onChange={(e) => onRetype(e.target.value as ValueType)}
        className="bg-rw-panel2 border border-rw-line rounded-[6px] px-1 h-[26px] text-[11px] outline-none focus:border-rw-accent cursor-pointer"
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title="Remove this pin"
        className="text-rw-faint hover:text-rw-error text-[13px] px-1 cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}

const sectionTitle = "text-[10px] font-bold tracking-[.08em] uppercase text-rw-faint pt-3 pb-2 flex items-center gap-1.5";

/**
 * The macro interface editor: rename, retype, add, and remove the macro's input and output
 * boundary pins. Each pin maps to a single-pin boundary node inside the definition canvas; editing
 * here keeps the pin id stable so existing inner and parent wires survive a rename or retype.
 */
export function MacroBoundaryPanel({
  inputs,
  outputs,
  onRename,
  onRetype,
  onRemove,
  onAddInput,
  onAddOutput,
}: {
  inputs: BoundaryPin[];
  outputs: BoundaryPin[];
  onRename: (nodeId: string, pinId: string, label: string) => void;
  onRetype: (nodeId: string, pinId: string, type: ValueType) => void;
  onRemove: (nodeId: string) => void;
  onAddInput: () => void;
  onAddOutput: () => void;
}) {
  return (
    <aside className="w-[270px] flex-none bg-rw-panel border-l border-rw-line flex flex-col min-h-0 overflow-y-auto">
      <div className="px-[14px] py-[13px] border-b border-rw-line">
        <div className="font-mono text-[13px] font-medium">Interface</div>
        <div className="text-[10px] text-rw-faint uppercase tracking-[.04em] mt-[2px]">Macro inputs &amp; outputs</div>
      </div>

      <div className="px-[14px] pb-5">
        <div className={sectionTitle}>
          <span className="text-rw-dim flex"><Icon name="io-in" size={13} /></span>
          Inputs
        </div>
        <div className="flex flex-col gap-1.5">
          {inputs.length === 0 && <p className="text-[11px] text-rw-faint italic">No inputs yet.</p>}
          {inputs.map((p) => (
            <PinRow
              key={`${p.nodeId}:${p.pinId}`}
              pin={p}
              onRename={(label) => onRename(p.nodeId, p.pinId, label)}
              onRetype={(type) => onRetype(p.nodeId, p.pinId, type)}
              onRemove={() => onRemove(p.nodeId)}
            />
          ))}
        </div>
        <button
          onClick={onAddInput}
          className="mt-2 w-full h-[26px] rounded-[6px] border border-dashed border-rw-line text-[11px] text-rw-dim hover:text-rw-text hover:border-rw-accent cursor-pointer"
        >
          + add input
        </button>

        <div className={sectionTitle}>
          <span className="text-rw-dim flex"><Icon name="io-out" size={13} /></span>
          Outputs
        </div>
        <div className="flex flex-col gap-1.5">
          {outputs.length === 0 && <p className="text-[11px] text-rw-faint italic">No outputs yet.</p>}
          {outputs.map((p) => (
            <PinRow
              key={`${p.nodeId}:${p.pinId}`}
              pin={p}
              onRename={(label) => onRename(p.nodeId, p.pinId, label)}
              onRetype={(type) => onRetype(p.nodeId, p.pinId, type)}
              onRemove={() => onRemove(p.nodeId)}
            />
          ))}
        </div>
        <button
          onClick={onAddOutput}
          className="mt-2 w-full h-[26px] rounded-[6px] border border-dashed border-rw-line text-[11px] text-rw-dim hover:text-rw-text hover:border-rw-accent cursor-pointer"
        >
          + add output
        </button>
      </div>
    </aside>
  );
}
