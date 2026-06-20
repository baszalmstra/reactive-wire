import { cn } from "../cn.js";

export type ToastKind = "error" | "info";

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

/** A transient bottom-right message, e.g. explaining why a connection was rejected. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <div
        key={toast.id}
        className={cn(
          "flex items-center gap-2 max-w-[340px] px-3 py-2 rounded-lg text-[12px] border shadow-rw [animation:rw-toast-in_.18s_ease-out]",
          toast.kind === "error"
            ? "text-rw-error border-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)] bg-[color-mix(in_oklab,var(--rw-h-error)_14%,var(--rw-panel))]"
            : "text-rw-text border-rw-line bg-rw-panel",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center w-[16px] h-[16px] rounded-full text-[10px] font-bold shrink-0 text-white",
            toast.kind === "error" ? "bg-rw-error" : "bg-rw-accent",
          )}
        >
          {toast.kind === "error" ? "⨯" : "i"}
        </span>
        <span className="min-w-0">{toast.text}</span>
      </div>
    </div>
  );
}
