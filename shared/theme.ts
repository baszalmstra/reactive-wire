// Reactive Wire design tokens.
// Three aesthetics (IDE / Blueprint / Warm), each with a dark + light variant.
// Value-type colors and health/error colors are shared across aesthetics and only
// tuned per light/dark, so the type language stays learnable everywhere.

import type { ValueType } from "./runtime-types.js";
export type { ValueType } from "./runtime-types.js";

export type Aesthetic = "ide" | "blueprint" | "warm";
export type Mode = "dark" | "light";

// One wire type (behaviors); color encodes the value type carried. Consistent
// lightness/chroma, hue does the work — desaturated enough to survive a dense graph.
const TYPE_DARK: Record<ValueType, string> = {
  bool: "oklch(0.80 0.115 182)",
  num: "oklch(0.74 0.130 252)",
  str: "oklch(0.84 0.125 95)",
  color: "oklch(0.74 0.165 318)",
  duration: "oklch(0.78 0.140 288)",
  datetime: "oklch(0.78 0.130 213)",
  any: "oklch(0.66 0.012 260)",
};
const TYPE_LIGHT: Record<ValueType, string> = {
  bool: "oklch(0.52 0.12 182)",
  num: "oklch(0.50 0.15 255)",
  str: "oklch(0.56 0.13 78)",
  color: "oklch(0.52 0.19 320)",
  duration: "oklch(0.52 0.17 290)",
  datetime: "oklch(0.50 0.13 215)",
  any: "oklch(0.62 0.012 260)",
};

// Health hues sit clear of the type palette (green at 150 vs boolean-teal at 182)
// so a health dot never reads as a pin.
// Solid health fills are distinct from semantic text. A bright warning dot is useful in either
// mode, but the same colour cannot also meet small-text contrast on a light surface.
const HEALTH_DARK = {
  ok: "oklch(0.76 0.13 150)",
  warn: "oklch(0.81 0.145 68)",
  error: "oklch(0.68 0.195 25)",
  stale: "oklch(0.62 0.015 260)",
};
const HEALTH_LIGHT = {
  ok: "oklch(0.58 0.13 150)",
  warn: "oklch(0.64 0.15 62)",
  error: "oklch(0.60 0.21 25)",
  stale: "oklch(0.62 0.012 260)",
};
const HEALTH_FG_DARK = {
  ok: "oklch(0.80 0.13 150)",
  warn: "oklch(0.86 0.145 68)",
  error: "oklch(0.76 0.19 25)",
  stale: "oklch(0.72 0.015 260)",
};
const HEALTH_FG_LIGHT = {
  ok: "oklch(0.40 0.13 150)",
  warn: "oklch(0.40 0.15 62)",
  error: "oklch(0.43 0.21 25)",
  stale: "oklch(0.43 0.012 260)",
};

interface Neutral {
  bg: string; canvas: string; gridDot: string;
  panel: string; panel2: string; line: string; lineSoft: string;
  node: string; nodeHdr: string; nodeBorder: string;
  text: string; dim: string; faint: string;
  accent: string; accentText: string; shadow: string; selGlow: string;
}
interface AestheticDef { grid: "dots" | "lines"; dark: Neutral; light: Neutral; }

const NEUTRALS: Record<Aesthetic, AestheticDef> = {
  ide: {
    grid: "dots",
    dark: {
      bg: "oklch(0.175 0.006 264)", canvas: "oklch(0.205 0.006 264)", gridDot: "oklch(0.33 0.012 264)",
      panel: "oklch(0.215 0.007 264)", panel2: "oklch(0.255 0.008 264)",
      line: "oklch(0.31 0.009 264)", lineSoft: "oklch(0.27 0.008 264)",
      node: "oklch(0.248 0.008 264)", nodeHdr: "oklch(0.30 0.010 264)", nodeBorder: "oklch(0.36 0.012 264)",
      text: "oklch(0.94 0.004 264)", dim: "oklch(0.74 0.006 264)", faint: "oklch(0.72 0.008 264)",
      accent: "oklch(0.66 0.15 264)", accentText: "oklch(0.12 0.01 264)",
      shadow: "0 6px 22px -6px rgba(0,0,0,.55)", selGlow: "oklch(0.70 0.14 264)",
    },
    light: {
      bg: "oklch(0.955 0.003 264)", canvas: "oklch(0.975 0.002 264)", gridDot: "oklch(0.85 0.006 264)",
      panel: "oklch(0.992 0.001 264)", panel2: "oklch(0.95 0.004 264)",
      line: "oklch(0.88 0.006 264)", lineSoft: "oklch(0.92 0.004 264)",
      node: "oklch(1 0 0)", nodeHdr: "oklch(0.972 0.004 264)", nodeBorder: "oklch(0.87 0.007 264)",
      text: "oklch(0.26 0.012 264)", dim: "oklch(0.46 0.012 264)", faint: "oklch(0.44 0.01 264)",
      accent: "oklch(0.55 0.17 264)", accentText: "oklch(0.99 0 0)",
      shadow: "0 6px 22px -8px rgba(20,22,40,.22)", selGlow: "oklch(0.55 0.16 264)",
    },
  },
  blueprint: {
    grid: "lines",
    dark: {
      bg: "oklch(0.168 0.030 255)", canvas: "oklch(0.192 0.034 255)", gridDot: "oklch(0.33 0.050 248)",
      panel: "oklch(0.205 0.034 255)", panel2: "oklch(0.245 0.040 255)",
      line: "oklch(0.31 0.045 250)", lineSoft: "oklch(0.27 0.038 252)",
      node: "oklch(0.238 0.038 255)", nodeHdr: "oklch(0.285 0.046 255)", nodeBorder: "oklch(0.36 0.052 250)",
      text: "oklch(0.93 0.010 250)", dim: "oklch(0.74 0.022 250)", faint: "oklch(0.72 0.030 250)",
      accent: "oklch(0.74 0.115 220)", accentText: "oklch(0.16 0.03 250)",
      shadow: "0 6px 24px -6px rgba(0,8,24,.62)", selGlow: "oklch(0.76 0.11 220)",
    },
    light: {
      bg: "oklch(0.935 0.018 248)", canvas: "oklch(0.965 0.014 242)", gridDot: "oklch(0.84 0.040 245)",
      panel: "oklch(0.982 0.010 245)", panel2: "oklch(0.928 0.020 245)",
      line: "oklch(0.855 0.032 245)", lineSoft: "oklch(0.905 0.022 245)",
      node: "oklch(1 0 0)", nodeHdr: "oklch(0.958 0.016 245)", nodeBorder: "oklch(0.85 0.034 245)",
      text: "oklch(0.27 0.040 255)", dim: "oklch(0.47 0.040 255)", faint: "oklch(0.44 0.030 250)",
      accent: "oklch(0.50 0.13 235)", accentText: "oklch(0.99 0 0)",
      shadow: "0 6px 22px -8px rgba(20,40,80,.20)", selGlow: "oklch(0.50 0.13 235)",
    },
  },
  warm: {
    grid: "dots",
    dark: {
      bg: "oklch(0.180 0.008 60)", canvas: "oklch(0.205 0.009 60)", gridDot: "oklch(0.34 0.013 58)",
      panel: "oklch(0.216 0.010 56)", panel2: "oklch(0.255 0.013 54)",
      line: "oklch(0.315 0.013 54)", lineSoft: "oklch(0.272 0.011 56)",
      node: "oklch(0.247 0.012 52)", nodeHdr: "oklch(0.298 0.015 52)", nodeBorder: "oklch(0.36 0.016 52)",
      text: "oklch(0.93 0.008 72)", dim: "oklch(0.74 0.011 66)", faint: "oklch(0.72 0.013 60)",
      accent: "oklch(0.74 0.130 64)", accentText: "oklch(0.18 0.02 60)",
      shadow: "0 6px 22px -6px rgba(20,12,0,.55)", selGlow: "oklch(0.76 0.12 64)",
    },
    light: {
      bg: "oklch(0.952 0.006 72)", canvas: "oklch(0.972 0.005 76)", gridDot: "oklch(0.86 0.011 70)",
      panel: "oklch(0.99 0.004 76)", panel2: "oklch(0.945 0.009 70)",
      line: "oklch(0.875 0.012 70)", lineSoft: "oklch(0.92 0.007 72)",
      node: "oklch(1 0 0)", nodeHdr: "oklch(0.966 0.008 76)", nodeBorder: "oklch(0.87 0.013 70)",
      text: "oklch(0.28 0.015 56)", dim: "oklch(0.47 0.015 60)", faint: "oklch(0.44 0.012 62)",
      accent: "oklch(0.56 0.14 60)", accentText: "oklch(0.99 0 0)",
      shadow: "0 6px 22px -8px rgba(60,40,10,.18)", selGlow: "oklch(0.56 0.14 60)",
    },
  },
};

/** A flat map of CSS custom properties to spread onto a wrapper's `style`. */
export function buildThemeVars(aesthetic: Aesthetic, mode: Mode): Record<string, string> {
  const a = NEUTRALS[aesthetic];
  const n = a[mode];
  const type = mode === "light" ? TYPE_LIGHT : TYPE_DARK;
  const health = mode === "light" ? HEALTH_LIGHT : HEALTH_DARK;
  const healthFg = mode === "light" ? HEALTH_FG_LIGHT : HEALTH_FG_DARK;
  return {
    "--rw-bg": n.bg, "--rw-canvas": n.canvas, "--rw-grid-dot": n.gridDot,
    "--rw-panel": n.panel, "--rw-panel2": n.panel2,
    "--rw-line": n.line, "--rw-line-soft": n.lineSoft,
    "--rw-node": n.node, "--rw-node-hdr": n.nodeHdr, "--rw-node-border": n.nodeBorder,
    "--rw-text": n.text, "--rw-dim": n.dim, "--rw-faint": n.faint,
    "--rw-accent": n.accent, "--rw-accent-text": n.accentText,
    "--rw-shadow": n.shadow, "--rw-sel": n.selGlow,
    "--rw-t-bool": type.bool, "--rw-t-num": type.num, "--rw-t-str": type.str,
    "--rw-t-color": type.color, "--rw-t-duration": type.duration,
    "--rw-t-datetime": type.datetime, "--rw-t-any": type.any,
    "--rw-h-ok": health.ok, "--rw-h-warn": health.warn,
    "--rw-h-error": health.error, "--rw-h-stale": health.stale,
    "--rw-h-ok-fg": healthFg.ok, "--rw-h-warn-fg": healthFg.warn,
    "--rw-h-error-fg": healthFg.error, "--rw-h-stale-fg": healthFg.stale,
    "--rw-health-on": "oklch(0.12 0.01 260)",
  };
}

export const gridStyle = (aesthetic: Aesthetic): "dots" | "lines" => NEUTRALS[aesthetic].grid;

/** Maps a value-type id to its CSS var. `any` is the unresolved/striped state. */
export const TYPE_VAR: Record<ValueType, string> = {
  bool: "var(--rw-t-bool)", num: "var(--rw-t-num)", str: "var(--rw-t-str)",
  color: "var(--rw-t-color)", duration: "var(--rw-t-duration)",
  datetime: "var(--rw-t-datetime)", any: "var(--rw-t-any)",
};

export const TYPE_LABEL: Record<ValueType, string> = {
  bool: "bool", num: "number", str: "string", color: "Color",
  duration: "Duration", datetime: "Datetime", any: "any",
};
