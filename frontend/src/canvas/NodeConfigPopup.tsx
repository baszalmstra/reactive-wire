import { useId, useState } from "react";
import type { RequiredConfig } from "./node-templates.js";
import type { EntityMap } from "../../../shared/entities.js";
import { EntityPicker } from "./EntityPicker.js";
import { ModalDialog } from "../components/ModalDialog.js";

/**
 * A modal to fill a node's required config right after it's created. Switches on
 * `requires.kind`, so new config kinds (number, area, …) plug in with one more case.
 */
export function NodeConfigPopup({
  requires,
  entities,
  onConfirm,
  onCancel,
}: {
  requires: RequiredConfig;
  entities: EntityMap;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const submit = () => {
    if (value) onConfirm(value);
  };

  return (
    <ModalDialog
      open
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-[420px] max-w-[92vw] rounded-[14px] shadow-rw overflow-visible"
    >
      <div className="bg-rw-panel border border-rw-line rounded-[14px] overflow-visible">
        <h2 id={titleId} className="px-[18px] pt-4 pb-1 font-bold text-[15px]">Choose {requires.label.toLowerCase()}</h2>
        <p id={descriptionId} className="px-[18px] pt-1 text-[11.5px] text-rw-dim">
          Select the required value before adding this node.
        </p>
        <div className="px-[18px] pt-2 pb-2">
          {requires.kind === "entity" && (
            <EntityPicker value={value} onChange={setValue} entities={entities} domains={requires.domains} autoFocus onSubmit={submit} />
          )}
        </div>
        <div className="flex justify-end gap-[9px] px-[18px] py-4 border-t border-rw-line mt-2">
          <button
            onClick={onCancel}
            className="h-[34px] px-4 rounded-lg border border-rw-line text-rw-dim hover:bg-rw-panel2 hover:text-rw-text text-[12.5px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!value}
            className="h-[34px] px-4 rounded-lg bg-rw-accent text-rw-accent-text font-bold text-[12.5px] disabled:opacity-50 disabled:cursor-default"
          >
            Add
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
