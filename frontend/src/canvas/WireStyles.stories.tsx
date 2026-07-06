import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TYPE_LABEL, TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { ER, ST, UN, V, formatValue, type RWValue } from "../../../shared/value.js";

type Variant = "simple" | "texture" | "recommended";

type Sample = {
  type: ValueType;
  value: RWValue;
  note: string;
};

const SAMPLES: Sample[] = [
  { type: "bool", value: V("bool", true), note: "binary state" },
  { type: "num", value: V("num", 21.7), note: "sensor reading" },
  { type: "str", value: V("str", "heating"), note: "mode / label" },
  { type: "color", value: V("color", "#ffcf5a"), note: "desired color" },
  { type: "duration", value: V("duration", 900), note: "elapsed / timeout" },
  { type: "datetime", value: V("datetime", Date.UTC(2026, 5, 15, 18, 30)), note: "instant" },
  { type: "any", value: V("any", "unresolved"), note: "generic" },
];

const STATUS_SAMPLES: Sample[] = [
  { type: "bool", value: V("bool", true), note: "ok" },
  { type: "num", value: ST("num", 19.4), note: "stale" },
  { type: "str", value: UN("str"), note: "unavailable" },
  { type: "num", value: ER("num", "bad input"), note: "error" },
];

function dashFor(type: ValueType): string | undefined {
  switch (type) {
    case "bool": return "0.1 9";
    case "str": return "10 7";
    case "datetime": return "2 7";
    case "any": return "5 7";
    default: return undefined;
  }
}

function glyphFor(type: ValueType): string {
  switch (type) {
    case "bool": return "●";
    case "num": return "#";
    case "str": return "Aa";
    case "color": return "◐";
    case "duration": return "⏱";
    case "datetime": return "◷";
    case "any": return "?";
  }
}

function statusClass(value: RWValue): string {
  if (value.status === "error") return "error";
  if (value.status === "unavailable") return "unavailable";
  if (value.status === "stale") return "stale";
  return "ok";
}

function ValueBadge({ value }: { value: RWValue }) {
  const formatted = formatValue(value);
  const swatch = value.status === "ok" && value.type === "color" ? String(value.v) : null;
  return (
    <span className={`wire-value ${statusClass(value)}`}>
      {swatch && <span className="wire-swatch" style={{ background: swatch }} />}
      {value.type === "bool" && value.status === "ok" && <span className={`wire-bool ${value.v ? "on" : "off"}`} />}
      {formatted.text}
    </span>
  );
}

function WirePreview({ sample, variant }: { sample: Sample; variant: Variant }) {
  const color = sample.value.status === "error" ? "var(--rw-h-error)" : TYPE_VAR[sample.type];
  const muted = sample.value.status === "unavailable";
  const stale = sample.value.status === "stale";
  const showTexture = variant !== "simple";
  const showValue = variant !== "texture";
  const d = "M 18 32 C 84 4, 176 60, 242 32";
  const dash = showTexture ? dashFor(sample.type) : undefined;
  const opacity = muted ? 0.34 : stale ? 0.58 : 1;
  const style = { "--wire": color } as CSSProperties;

  return (
    <div className={`wire-demo ${variant} ${statusClass(sample.value)}`} style={style}>
      <svg viewBox="0 0 260 64" aria-hidden="true">
        <path className="wire-halo" d={d} />
        {sample.type === "duration" && showTexture ? (
          <>
            <path className="wire-main" d={d} transform="translate(0 -3)" style={{ opacity }} />
            <path className="wire-main" d={d} transform="translate(0 3)" style={{ opacity }} />
          </>
        ) : (
          <path className="wire-main" d={d} strokeDasharray={dash} style={{ opacity }} />
        )}
        {variant === "recommended" && sample.value.status === "ok" && (
          <>
            <circle className="wire-port" cx="18" cy="32" r="4.3" />
            <circle className="wire-port" cx="242" cy="32" r="4.3" />
          </>
        )}
      </svg>
      {showValue && <ValueBadge value={sample.value} />}
      {variant === "texture" && <span className="wire-glyph">{glyphFor(sample.type)}</span>}
    </div>
  );
}

function Column({ title, children, blurb }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="wire-column">
      <h3>{title}</h3>
      <p>{blurb}</p>
      <div className="wire-stack">{children}</div>
    </section>
  );
}

function WireRow({ sample }: { sample: Sample }) {
  return (
    <div className="wire-row">
      <div className="wire-row-label">
        <span className="wire-type-dot" style={{ background: TYPE_VAR[sample.type] }} />
        <strong>{TYPE_LABEL[sample.type]}</strong>
        <small>{sample.note}</small>
      </div>
      <WirePreview sample={sample} variant="simple" />
      <WirePreview sample={sample} variant="texture" />
      <WirePreview sample={sample} variant="recommended" />
    </div>
  );
}

function WireStylePrototype() {
  return (
    <div className="wire-page">
      <style>{css}</style>
      <header className="wire-header">
        <div>
          <h1>Wire style prototype</h1>
          <p>
            Three directions for making wires communicate both <b>type</b> and <b>current value</b>.
            The rightmost option is the proposed default: type color + subtle type texture + a compact live value badge.
          </p>
        </div>
      </header>

      <div className="wire-grid-head">
        <span />
        <span>Simple color</span>
        <span>Type texture</span>
        <span>Recommended</span>
      </div>
      <div className="wire-table">
        {SAMPLES.map((sample) => <WireRow key={sample.type} sample={sample} />)}
      </div>

      <div className="wire-columns">
        <Column title="Status handling" blurb="Status should be visible even without hovering, because it changes safety semantics.">
          {STATUS_SAMPLES.map((sample) => <WirePreview key={sample.note} sample={sample} variant="recommended" />)}
        </Column>
        <Column title="Rules this prototype tests" blurb="The pattern should stay learnable and not fight the existing pin/chip language.">
          <ul className="wire-rules">
            <li>Color always means value type.</li>
            <li>Texture is secondary and helps color-blind/complex graphs.</li>
            <li>The badge shows current value, not pin schema.</li>
            <li>Error/unavailable/stale override the wire status.</li>
          </ul>
        </Column>
      </div>
    </div>
  );
}

const css = `
.wire-page { width: min(1180px, calc(100vw - 64px)); color: var(--rw-text); }
.wire-header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.wire-header h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -0.03em; }
.wire-header p { margin: 0; max-width: 780px; color: var(--rw-dim); line-height: 1.55; }
.wire-grid-head, .wire-row { display: grid; grid-template-columns: 180px repeat(3, minmax(210px, 1fr)); gap: 14px; align-items: center; }
.wire-grid-head { color: var(--rw-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; padding: 0 14px 8px; }
.wire-table { display: flex; flex-direction: column; gap: 10px; }
.wire-row { padding: 11px 14px; border: 1px solid var(--rw-line-soft); border-radius: 14px; background: color-mix(in oklab, var(--rw-panel) 86%, transparent); }
.wire-row-label { display: grid; grid-template-columns: 12px 1fr; column-gap: 9px; row-gap: 3px; align-items: center; }
.wire-row-label small { grid-column: 2; color: var(--rw-faint); font-size: 11px; }
.wire-type-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in oklab, currentColor 6%, transparent); }
.wire-demo { position: relative; height: 64px; border-radius: 12px; background: color-mix(in oklab, var(--rw-canvas) 74%, var(--rw-panel2)); overflow: hidden; border: 1px solid var(--rw-line-soft); }
.wire-demo svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.wire-halo { fill: none; stroke: color-mix(in oklab, var(--rw-bg) 84%, transparent); stroke-width: 8; stroke-linecap: round; }
.wire-main { fill: none; stroke: var(--wire); stroke-width: 3.2; stroke-linecap: round; filter: drop-shadow(0 0 3px color-mix(in oklab, var(--wire) 45%, transparent)); }
.wire-demo.texture .wire-main { stroke-width: 3.7; }
.wire-demo.recommended .wire-main { stroke-width: 3.4; }
.wire-port { fill: var(--rw-canvas); stroke: var(--wire); stroke-width: 2; }
.wire-value { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 6px; max-width: 118px; padding: 4px 8px; border-radius: 999px; border: 1px solid color-mix(in oklab, var(--wire) 58%, var(--rw-line)); background: color-mix(in oklab, var(--rw-panel) 90%, transparent); color: var(--rw-text); font: 500 10.5px var(--font-mono); white-space: nowrap; box-shadow: 0 6px 18px -10px rgba(0,0,0,.55); }
.wire-value.stale { border-style: dashed; color: var(--rw-faint); }
.wire-value.unavailable { border-style: dashed; color: var(--rw-faint); background: color-mix(in oklab, var(--rw-panel2) 78%, transparent); }
.wire-value.error { border-color: var(--rw-h-error); color: var(--rw-h-error); }
.wire-swatch { width: 12px; height: 12px; border-radius: 4px; border: 1px solid var(--rw-line); }
.wire-bool { width: 8px; height: 8px; border-radius: 50%; background: var(--rw-line); }
.wire-bool.on { background: var(--rw-h-ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--rw-h-ok) 20%, transparent); }
.wire-glyph { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--wire); border: 1px solid color-mix(in oklab, var(--wire) 60%, transparent); background: var(--rw-panel); font: 700 10px var(--font-mono); }
.wire-demo.stale .wire-main { stroke-dasharray: 12 7; opacity: .55; }
.wire-demo.unavailable .wire-main { stroke-dasharray: 3 8; opacity: .35; filter: none; }
.wire-demo.error .wire-main { stroke: var(--rw-h-error); stroke-dasharray: 8 5; filter: drop-shadow(0 0 4px color-mix(in oklab, var(--rw-h-error) 60%, transparent)); }
.wire-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 22px; }
.wire-column { border: 1px solid var(--rw-line-soft); border-radius: 16px; background: var(--rw-panel); padding: 16px; }
.wire-column h3 { margin: 0 0 4px; font-size: 15px; }
.wire-column p { margin: 0 0 14px; color: var(--rw-faint); font-size: 12px; line-height: 1.45; }
.wire-stack { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 10px; }
.wire-rules { margin: 0; padding-left: 18px; color: var(--rw-dim); line-height: 1.8; }
@media (max-width: 920px) {
  .wire-grid-head { display: none; }
  .wire-row { grid-template-columns: 1fr; }
  .wire-columns { grid-template-columns: 1fr; }
}
`;

const meta: Meta<typeof WireStylePrototype> = {
  title: "Design/Wire style prototype",
  component: WireStylePrototype,
};
export default meta;

type Story = StoryObj<typeof WireStylePrototype>;

export const Gallery: Story = {};
