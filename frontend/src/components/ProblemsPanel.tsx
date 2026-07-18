import { cn } from "../cn.js";
import { problemCounts, type Problem, type Severity } from "../canvas/problems.js";

const SEV_ICON: Record<Severity, string> = { error: "✕", warn: "△" };

function ProblemRow({ p, onFocus }: { p: Problem; onFocus: (id: string) => void }) {
  return (
    <button
      onClick={() => onFocus(p.node)}
      className={cn(
        "group w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-[11.5px] border transition-colors cursor-pointer",
        "border-rw-line-soft hover:bg-rw-panel2",
        p.severity === "error" ? "bg-[color-mix(in_oklab,var(--rw-h-error)_8%,transparent)]" : "bg-[color-mix(in_oklab,var(--rw-h-warn)_7%,transparent)]",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-extrabold shrink-0 text-white",
          p.severity === "error" ? "bg-rw-error-fill" : "bg-rw-warn-fill",
        )}
      >
        {SEV_ICON[p.severity]}
      </span>
      <span className="font-mono text-rw-text shrink-0 max-w-[110px] truncate">{p.title}</span>
      <span className="text-rw-dim flex-1 min-w-0 truncate">{p.message}</span>
      <span className="text-rw-faint text-[10px] opacity-0 group-hover:opacity-100 shrink-0">focus →</span>
    </button>
  );
}

function Column({ title, problems, onFocus }: { title: string; problems: Problem[]; onFocus: (id: string) => void }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-[.06em] text-rw-faint px-1">{title}</div>
      {problems.length ? (
        problems.map((p) => <ProblemRow key={p.id} p={p} onFocus={onFocus} />)
      ) : (
        <div className="text-[11px] text-rw-faint px-2 py-3">No problems.</div>
      )}
    </div>
  );
}

/** A two-column list of structural (edit-time) and runtime (live) problems; each row focuses its node. */
export function ProblemsPanel({
  problems,
  open,
  onClose,
  onFocus,
}: {
  problems: Problem[];
  open: boolean;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  if (!open) return null;
  const structural = problems.filter((p) => p.scope === "structural");
  const runtime = problems.filter((p) => p.scope === "runtime");
  const { errors, warns } = problemCounts(problems);

  return (
    <div className="absolute left-3 right-3 bottom-3 z-20 max-h-[42%] flex flex-col rounded-xl border border-rw-line bg-rw-panel shadow-rw overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-rw-line-soft shrink-0">
        <span className="font-bold text-[12px]">Problems</span>
        <span className="text-[11px] text-rw-error">{errors} error{errors === 1 ? "" : "s"}</span>
        <span className="text-[11px] text-rw-warn">{warns} warning{warns === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="w-6 h-6 inline-flex items-center justify-center rounded-md text-rw-dim hover:bg-rw-panel2 hover:text-rw-text cursor-pointer"
          title="Close"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-3 p-3 overflow-auto">
        <Column title="Structural · edit-time" problems={structural} onFocus={onFocus} />
        <div className="w-px self-stretch bg-rw-line-soft" />
        <Column title="Runtime · live" problems={runtime} onFocus={onFocus} />
      </div>
    </div>
  );
}
