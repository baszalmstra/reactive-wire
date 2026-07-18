import { useMemo, type CSSProperties } from "react";
import { TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { formatDatetime, formatDuration, formatValue, type RWValue } from "../../../shared/value.js";
import { ValueChip } from "./ValueChip.js";

/** One observed sample: the value and when it was seen. */
export interface Sample {
  value: RWValue;
  t: number;
}

const WIDTH = 200;
const HEIGHT = 56;
const TOP = 6;
const BOTTOM = 50;

// A small categorical palette, intentionally independent of the value-type colors. Home Assistant
// history bars use stable per-state colors; doing the same here makes enum/string changes readable
// even when every sample has the same wire type.
const CATEGORICAL_PALETTE = [
  "oklch(0.68 0.15 24)",
  "oklch(0.72 0.14 68)",
  "oklch(0.70 0.13 142)",
  "oklch(0.70 0.13 205)",
  "oklch(0.68 0.15 268)",
  "oklch(0.70 0.14 326)",
  "oklch(0.76 0.12 182)",
  "oklch(0.72 0.12 95)",
];

interface Run {
  key: string;
  sample: Sample;
  count: number;
  start: number;
  end: number;
}

/** Pulls the plottable number out of a sample, or null for absent/error/non-numeric. */
function plotNumber(s: Sample, kind: "num" | "duration"): number | null {
  const v = s.value;
  if (!isPresent(v)) return null;
  if (v.type !== kind) return null;
  const n = Number(v.v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A tiny chart of a pin's recent value history. Numeric pins get a real sparkline; durations
 * reuse that plot with duration labels. Other pins become type-aware status strips: booleans show
 * on/off time, datetimes show relative/changed-at summaries, and strings/enums/objects collapse
 * consecutive repeats so the user sees changes instead of the same value spammed over and over.
 * Absent and error samples leave gaps in numeric lines and muted slices in state strips.
 */
export function Sparkline({ history, timeZone }: { history: Sample[]; timeZone?: string }) {
  const valueType = useMemo(() => historyValueType(history), [history]);
  const numericKind = valueType === "num" || valueType === "duration" ? valueType : null;

  const plot = useMemo(() => {
    if (!numericKind) return null;
    const nums = history.map((s) => plotNumber(s, numericKind));
    const present = nums.filter((n): n is number => n !== null);
    if (present.length < 2) return null;
    const min = Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    const n = history.length;
    // Map each sample to a coordinate; absent/error samples break the line into segments.
    const xy = nums.map((v, i) => {
      if (v === null) return null;
      const x = n === 1 ? 0 : (i / (n - 1)) * WIDTH;
      const y = BOTTOM - ((v - min) / span) * (BOTTOM - TOP);
      return { x, y };
    });
    const segments: string[] = [];
    let run: string[] = [];
    for (const p of xy) {
      if (p === null) {
        if (run.length) segments.push(run.join(" "));
        run = [];
      } else {
        run.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
    }
    if (run.length) segments.push(run.join(" "));
    const lastXY = [...xy].reverse().find((p): p is { x: number; y: number } => p !== null) ?? null;
    return { min, max, segments, lastXY };
  }, [history, numericKind]);

  // Numeric / duration sparkline.
  if (plot && numericKind) {
    const color = TYPE_VAR[numericKind];
    return (
      <div className="relative rounded-[7px] border border-rw-line bg-rw-panel2 px-2 pt-2 pb-1">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block w-full h-[56px]">
          <line x1={0} y1={BOTTOM} x2={WIDTH} y2={BOTTOM} stroke="var(--rw-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {plot.segments.map((pts, i) => (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {plot.lastXY && (
            <circle cx={plot.lastXY.x} cy={plot.lastXY.y} r={2.4} fill={color} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <div className="flex justify-between text-[9px] font-mono text-rw-faint pt-0.5">
          <span>{formatPlotLabel(plot.max, numericKind)}</span>
          <span>{formatPlotLabel(plot.min, numericKind)}</span>
        </div>
      </div>
    );
  }

  // Empty / sampling state.
  if (history.length < 2) {
    return <SamplingSparkline />;
  }

  if (valueType === "datetime") return <DatetimeHistory history={history} timeZone={timeZone} />;
  if (valueType === "bool") return <BooleanHistory history={history} timeZone={timeZone} />;
  return <CategoricalHistory history={history} timeZone={timeZone} />;
}

function SamplingSparkline() {
  return (
    <div className="relative rounded-[7px] border border-rw-line bg-rw-panel2 px-2 pt-2 pb-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block w-full h-[56px]">
        <line x1={0} y1={BOTTOM - 10} x2={WIDTH} y2={BOTTOM - 10} stroke="var(--rw-line)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-[9px] text-rw-faint pt-0.5">value history — sampling…</div>
    </div>
  );
}

function BooleanHistory({ history, timeZone }: { history: Sample[]; timeZone?: string }) {
  const runs = useMemo(() => buildRuns(history), [history]);
  const latest = history[history.length - 1];
  const valid = history.filter((s) => isPresent(s.value) && s.value.type === "bool");
  const trueCount = valid.filter((s) => s.value.v === true).length;
  const pct = valid.length ? `${Math.round((trueCount / valid.length) * 100)}% on` : "no live samples";
  return (
    <HistoryCard>
      <StateStrip runs={runs} timeZone={timeZone} />
      <HistorySummary
        primary={latest ? <CurrentValueSummary value={latest.value} timeZone={timeZone} /> : "waiting for value"}
        secondary={`${changeSummary(runs, history)} · ${pct}`}
      />
    </HistoryCard>
  );
}

function DatetimeHistory({ history, timeZone }: { history: Sample[]; timeZone?: string }) {
  const runs = useMemo(() => buildRuns(history), [history]);
  const latest = latestDatetime(history);
  const fallback = history[history.length - 1];
  const now = Date.now();
  const trackingNow = isTrackingNow(history);
  const primary = latest
    ? trackingNow
      ? "tracking now"
      : formatRelativeInstant(latest.ms, now, timeZone)
    : fallback
      ? formatHistoryLabel(fallback, timeZone)
      : "waiting for value";
  const secondary = latest
    ? `${formatDatetime(latest.ms, timeZone)} · ${trackingNow ? "updates continuously" : changeSummary(runs, history)}`
    : changeSummary(runs, history);

  return (
    <HistoryCard>
      <StateStrip runs={runs} timeZone={timeZone} />
      <HistorySummary primary={primary} secondary={secondary} />
    </HistoryCard>
  );
}

function CategoricalHistory({ history, timeZone }: { history: Sample[]; timeZone?: string }) {
  const runs = useMemo(() => buildRuns(history), [history]);
  const latest = history[history.length - 1];
  const distinct = new Set(history.filter((s) => isPresent(s.value)).map((s) => sampleKey(s, { ignoreStatus: true }))).size;
  const states = distinct > 1 ? ` · ${distinct} states` : "";
  return (
    <HistoryCard>
      <StateStrip runs={runs} inlineLabels timeZone={timeZone} />
      <HistorySummary
        primary={latest ? `currently ${formatHistoryLabel(latest, timeZone)}` : "waiting for value"}
        secondary={`${changeSummary(runs, history)}${states}`}
      />
      <RunPills runs={runs} timeZone={timeZone} />
    </HistoryCard>
  );
}

function HistoryCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[7px] border border-rw-line bg-rw-panel2 px-2 py-1.5 flex flex-col gap-1.5">{children}</div>;
}

function CurrentValueSummary({ value, timeZone }: { value: RWValue; timeZone?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span>currently</span>
      <ValueChip value={value} timeZone={timeZone} />
    </span>
  );
}

function HistorySummary({ primary, secondary }: { primary: React.ReactNode; secondary: string }) {
  return (
    <div className="min-w-0 flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate font-mono text-[10px] text-rw-text">{primary}</span>
      <span className="shrink-0 font-mono text-[9px] text-rw-faint">{secondary}</span>
    </div>
  );
}

function StateStrip({ runs, inlineLabels = false, timeZone }: { runs: Run[]; inlineLabels?: boolean; timeZone?: string }) {
  const visible = runs.slice(-48);
  return (
    <div className={`flex ${inlineLabels ? "h-7" : "h-6"} overflow-hidden rounded-[5px] border border-rw-line bg-rw-panel`}>
      {visible.map((run) => (
        <div
          key={`${run.start}:${run.key}`}
          title={`${formatHistoryLabel(run.sample, timeZone)} · ${run.count} sample${run.count === 1 ? "" : "s"}`}
          className={segmentClass(run.sample, inlineLabels)}
          style={segmentStyle(run)}
        >
          {inlineLabels ? <span className="min-w-0 truncate px-1 text-[9px] font-mono font-semibold leading-none text-rw-text [text-shadow:0_1px_2px_rgba(0,0,0,.45)]">{formatHistoryLabel(run.sample, timeZone)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function RunPills({ runs, timeZone }: { runs: Run[]; timeZone?: string }) {
  const recent = runs.slice(-5);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {recent.map((run) => (
        <span
          key={`${run.start}:${run.key}`}
          className="min-w-0 max-w-full truncate inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded-[4px] border-[0.5px] text-rw-dim border-rw-line bg-rw-panel"
          title={formatHistoryLabel(run.sample, timeZone)}
          style={segmentStyle(run)}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--tc)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--tc)_45%,transparent)]" />
          <span className="truncate">{formatHistoryLabel(run.sample, timeZone)}</span>
          {run.count > 1 ? <span className="text-rw-faint ml-0.5">×{run.count}</span> : null}
        </span>
      ))}
    </div>
  );
}

function segmentStyle(run: Run): CSSProperties {
  return {
    flexGrow: Math.max(1, run.count),
    ["--tc" as string]: sampleTone(run.sample, run.key),
  };
}

function segmentClass(sample: Sample, inlineLabel = false): string {
  const value = sample.value;
  const base = `min-w-[3px] border-r border-rw-panel2 last:border-r-0 ${inlineLabel ? "flex items-center justify-center overflow-hidden" : ""}`;
  if (value.status === "error") return `${base} bg-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)]`;
  if (value.status === "unavailable") return `${base} bg-transparent opacity-55`;
  if (value.type === "bool") {
    return value.v === true
      ? `${base} bg-[color-mix(in_oklab,var(--tc)_78%,transparent)]`
      : `${base} bg-[color-mix(in_oklab,var(--tc)_14%,transparent)]`;
  }
  if (value.status === "stale") return `${base} bg-[color-mix(in_oklab,var(--tc)_35%,var(--rw-panel))] opacity-60`;
  return `${base} bg-[color-mix(in_oklab,var(--tc)_72%,var(--rw-panel))]`;
}

function buildRuns(history: Sample[]): Run[] {
  const runs: Run[] = [];
  history.forEach((sample, i) => {
    const key = sampleKey(sample);
    const last = runs[runs.length - 1];
    if (last && last.key === key) {
      last.count += 1;
      last.end = i;
    } else {
      runs.push({ key, sample, count: 1, start: i, end: i });
    }
  });
  return runs;
}

function sampleKey(sample: Sample, opts: { ignoreStatus?: boolean } = {}): string {
  const value = sample.value;
  const status = opts.ignoreStatus ? "" : `${value.status}:`;
  if (value.status === "error" || value.status === "unavailable") return `${status}${value.type}`;
  if (value.type === "num" || value.type === "duration" || value.type === "datetime") return `${status}${value.type}:${Number(value.v)}`;
  if (value.type === "color") return `${status}color:${String(value.v).toLowerCase()}`;
  return `${status}${value.type}:${stableValueText(value.v)}`;
}

function historyValueType(history: Sample[]): ValueType | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const value = history[i]?.value;
    if (value && isPresent(value)) return value.type;
  }
  return history[history.length - 1]?.value.type ?? null;
}

function isPresent(value: RWValue): boolean {
  return value.status === "ok" || value.status === "stale";
}

function sampleTone(sample: Sample, key = sampleKey(sample)): string {
  const value = sample.value;
  if (isPresent(value) && value.type === "color" && typeof value.v === "string" && value.v.startsWith("#")) return value.v;
  if (isPresent(value) && (value.type === "str" || value.type === "any")) return categoricalColor(key);
  return TYPE_VAR[value.type] ?? TYPE_VAR.any;
}

function categoricalColor(key: string): string {
  return CATEGORICAL_PALETTE[stableHash(key) % CATEGORICAL_PALETTE.length] ?? TYPE_VAR.str;
}

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function formatPlotLabel(n: number, kind: "num" | "duration"): string | number {
  return kind === "duration" ? formatDuration(n) : round(n);
}

function formatHistoryLabel(sample: Sample, timeZone?: string): string {
  const value = sample.value;
  if (value.status === "error") return "error";
  if (value.status === "unavailable") return "—";
  if (isPresent(value) && value.type === "str") return truncateLabel(String(value.v), 18);
  if (value.type === "any" && value.v && typeof value.v === "object") return objectSummary(value.v);
  const formatted = formatValue(value, timeZone);
  return formatted.kind === "unavail" ? "—" : formatted.text;
}

function changeSummary(runs: Run[], history: Sample[]): string {
  const changes = Math.max(0, runs.length - 1);
  const window = historyWindow(history);
  if (changes === 0) return window ? `unchanged ${window}` : "unchanged";
  const lastRun = runs[runs.length - 1];
  const lastChanged = lastRun ? ` · last ${formatAge(lastRun.sample.t)}` : "";
  return `changed ${changes}×${lastChanged}`;
}

function formatAge(t: number): string {
  const seconds = Math.max(0, (Date.now() - t) / 1000);
  return `${formatDuration(seconds)} ago`;
}

function historyWindow(history: Sample[]): string {
  if (history.length < 2) return "";
  const first = history.at(0);
  const last = history.at(-1);
  if (!first || !last) return "";
  const seconds = (last.t - first.t) / 1000;
  return seconds > 0 ? `for ${formatDuration(seconds)}` : "";
}

function latestDatetime(history: Sample[]): { sample: Sample; ms: number } | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sample = history[i];
    if (!sample) continue;
    const ms = datetimeMs(sample);
    if (ms !== null) return { sample, ms };
  }
  return null;
}

function datetimeMs(sample: Sample): number | null {
  const value = sample.value;
  if (!isPresent(value) || value.type !== "datetime") return null;
  const ms = Number(value.v);
  return Number.isFinite(ms) ? ms : null;
}

function isTrackingNow(history: Sample[]): boolean {
  const recent = history.slice(-12).map((sample) => ({ sample, ms: datetimeMs(sample) })).filter((x): x is { sample: Sample; ms: number } => x.ms !== null);
  return recent.length >= 3 && recent.every(({ sample, ms }) => Math.abs(ms - sample.t) < 2000);
}

function formatRelativeInstant(ms: number, now: number, timeZone?: string): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 15_000) return "now";

  const dayDiff = calendarDayDiff(ms, now, timeZone);
  if (dayDiff === 1) return `tomorrow ${formatClock(ms, timeZone)}`;
  if (dayDiff === -1) return `yesterday ${formatClock(ms, timeZone)}`;
  if (Math.abs(dayDiff) > 1 && Math.abs(dayDiff) < 7) return `${formatWeekday(ms, timeZone)} ${formatClock(ms, timeZone)}`;

  const delta = formatRelativeDelta(abs);
  return diff > 0 ? `in ${delta}` : `${delta} ago`;
}

function formatRelativeDelta(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function calendarDayDiff(ms: number, now: number, timeZone?: string): number {
  if (!timeZone) {
    const day = (x: number) => {
      const d = new Date(x);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    return Math.round((day(ms) - day(now)) / 86_400_000);
  }
  const formatter = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
  const day = (x: number) => {
    const parts = formatter.formatToParts(x);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
  };
  return Math.round((day(ms) - day(now)) / 86_400_000);
}

function formatClock(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatWeekday(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleDateString(undefined, { ...(timeZone ? { timeZone } : {}), weekday: "short" });
}

function stableValueText(value: unknown): string {
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function objectSummary(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const head = keys.slice(0, 2).join(", ");
    return `{${head}${keys.length > 2 ? ", …" : ""}}`;
  }
  return String(value ?? "—");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
