import { describe, expect, it } from "vitest";
import { buildThemeVars, type Aesthetic, type Mode } from "../../shared/theme.js";

function rgb(value: string): [number, number, number] {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`Expected OKLCH token, got ${value}`);
  const l = Number(match[1]);
  const c = Number(match[2]);
  const h = Number(match[3]) * Math.PI / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = lp ** 3;
  const mm = mp ** 3;
  const ss = sp ** 3;
  const clamp = (channel: number) => Math.max(0, Math.min(1, channel));
  return [
    clamp(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
    clamp(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
    clamp(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
  ];
}

function contrastRgb(a: [number, number, number], b: [number, number, number]): number {
  const luminance = ([r, g, blue]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function contrast(a: string, b: string): number {
  return contrastRgb(rgb(a), rgb(b));
}

/** Conservative alpha composition in linear sRGB for the subtle rendered status/chip fills. */
function composite(foreground: string, background: string, alpha: number): [number, number, number] {
  const fg = rgb(foreground);
  const bg = rgb(background);
  return fg.map((channel, index) => channel * alpha + bg[index]! * (1 - alpha)) as [number, number, number];
}

const aesthetics: Aesthetic[] = ["ide", "blueprint", "warm"];
const modes: Mode[] = ["dark", "light"];

describe("theme accessibility", () => {
  it("keeps faint small text readable on common surfaces", () => {
    for (const aesthetic of aesthetics) for (const mode of modes) {
      const vars = buildThemeVars(aesthetic, mode);
      for (const surface of ["--rw-panel", "--rw-node", "--rw-node-hdr"] as const) {
        expect(contrast(vars["--rw-faint"]!, vars[surface]!), `${aesthetic}/${mode} faint on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("separates readable health text from solid health fills", () => {
    for (const aesthetic of aesthetics) for (const mode of modes) {
      const vars = buildThemeVars(aesthetic, mode);
      for (const health of ["ok", "warn", "error"] as const) {
        expect(contrast(vars[`--rw-h-${health}-fg`]!, vars["--rw-panel"]!), `${aesthetic}/${mode} ${health} text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars["--rw-health-on"]!, vars[`--rw-h-${health}`]!), `${aesthetic}/${mode} glyph on ${health}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps rendered small-text combinations readable without opacity loss", () => {
    for (const aesthetic of aesthetics) for (const mode of modes) {
      const vars = buildThemeVars(aesthetic, mode);
      expect(
        contrast(vars["--rw-dim"]!, vars["--rw-panel2"]!),
        `${aesthetic}/${mode} draft subline`,
      ).toBeGreaterThanOrEqual(4.5);
      const warningSurface = composite(vars["--rw-h-warn"]!, vars["--rw-panel"]!, 0.12);
      expect(
        contrastRgb(rgb(vars["--rw-h-warn-fg"]!), warningSurface),
        `${aesthetic}/${mode} reconnect text on warning surface`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps actual solid badge and active-control foregrounds readable", () => {
    for (const aesthetic of aesthetics) for (const mode of modes) {
      const vars = buildThemeVars(aesthetic, mode);
      expect(
        contrast(vars["--rw-accent-text"]!, vars["--rw-accent"]!),
        `${aesthetic}/${mode} active button text on accent`,
      ).toBeGreaterThanOrEqual(4.5);
      for (const health of ["ok", "warn", "error"] as const) {
        expect(
          contrast(vars["--rw-health-on"]!, vars[`--rw-h-${health}`]!),
          `${aesthetic}/${mode} badge glyph on ${health} fill`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
