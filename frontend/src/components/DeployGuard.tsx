import { useId } from "react";
import { cn } from "../cn.js";
import { problemCounts, type Problem } from "../canvas/problems.js";
import { ModalDialog } from "./ModalDialog.js";

/**
 * A confirmation modal shown before a deploy. Hard errors block the deploy outright; soft
 * warnings can be deployed past with an explicit "Deploy anyway".
 */
export function DeployGuard({
  open,
  problems,
  summary,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  problems: Problem[];
  summary: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const summaryId = useId();
  const { errors, warns } = problemCounts(problems);
  const blocked = errors > 0;
  const ordered = [...problems].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));

  return (
    <ModalDialog
      open={open}
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={summaryId}
      className="w-[460px] max-w-[92vw] max-h-[80vh] rounded-2xl shadow-rw"
    >
      <div className="max-h-[80vh] flex flex-col rounded-2xl border border-rw-line bg-rw-panel text-rw-text overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-rw-line-soft shrink-0">
          <h2 id={titleId} className="font-bold text-[13px]">Deploy to your home</h2>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            aria-label="Close deploy dialog"
            className="w-6 h-6 inline-flex items-center justify-center rounded-md text-rw-dim hover:bg-rw-panel2 hover:text-rw-text cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div id={summaryId} className="px-4 pt-3 text-[12px] text-rw-dim [overflow-wrap:anywhere]">{summary}</div>

        <div className="px-4 pt-3">
          {blocked ? (
            <div className="flex items-center gap-2 text-[12px] text-rw-error">
              <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-rw-error-fill text-rw-health-on text-[10px] font-bold">✕</span>
              Deploy blocked — {errors} hard error{errors === 1 ? "" : "s"} must be resolved first.
            </div>
          ) : warns > 0 ? (
            <div className="flex items-center gap-2 text-[12px] text-rw-warn">
              <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-rw-warn-fill text-rw-health-on text-[10px] font-bold">△</span>
              {warns} warning{warns === 1 ? "" : "s"} — degraded inputs will deploy as-is.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px] text-rw-ok">
              <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full bg-rw-ok-fill text-rw-health-on text-[10px] font-bold">✓</span>
              No problems. Safe to deploy.
            </div>
          )}
        </div>

        {ordered.length > 0 && (
          <div className="px-4 pt-3 flex-1 overflow-auto flex flex-col gap-1.5">
            {ordered.map((p) => (
              <div
                key={p.id}
                className="flex items-start gap-2 px-2.5 py-1.5 rounded-md border border-rw-line-soft bg-rw-bg text-[11.5px]"
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-extrabold shrink-0 text-rw-health-on mt-px",
                    p.severity === "error" ? "bg-rw-error-fill" : "bg-rw-warn-fill",
                  )}
                >
                  {p.severity === "error" ? "✕" : "△"}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <b className="font-mono text-rw-text">{p.title}</b> <span className="text-rw-dim">{p.message}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 mt-3 border-t border-rw-line-soft shrink-0">
          <button
            onClick={onCancel}
            data-dialog-initial
            className="h-8 px-3.5 rounded-lg text-[12px] border border-rw-line text-rw-dim hover:bg-rw-panel2 hover:text-rw-text cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={blocked}
            className="h-8 px-4 rounded-lg bg-rw-accent text-rw-accent-text font-bold text-[12px] cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-default"
          >
            {blocked ? "Resolve errors to deploy" : warns > 0 ? "Deploy anyway" : "Deploy"}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
