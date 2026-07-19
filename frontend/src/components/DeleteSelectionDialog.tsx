import { useId } from "react";
import { ModalDialog } from "./ModalDialog.js";

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Confirms deletion from the touch bar and states the full graph impact before it happens. */
export function DeleteSelectionDialog({
  open,
  nodeCount,
  edgeCount,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  nodeCount: number;
  edgeCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const targets = [
    nodeCount > 0 && countLabel(nodeCount, "node"),
    edgeCount > 0 && countLabel(edgeCount, "wire"),
  ].filter(Boolean).join(" and ");

  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-[400px] max-w-[92vw] rounded-2xl shadow-rw"
    >
      <div className="bg-rw-panel border border-rw-line rounded-2xl p-5">
        <h2 id={titleId} className="text-[17px] font-semibold">Delete selection?</h2>
        <p id={descriptionId} className="mt-2 text-[13px] leading-5 text-rw-dim">
          This will delete {targets}. You can undo this action afterwards.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rw-btn" data-dialog-initial onClick={onCancel}>Cancel</button>
          <button type="button" className="rw-btn danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </ModalDialog>
  );
}
