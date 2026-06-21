# Code Context

## Files Retrieved
1. `C:\Users\bas\Downloads\Reactive Wire (standalone).html` (line 180, embedded template CSS around `.rw-inspector` / `.rw-insp-*`) - original standalone inspector styling source.
2. `frontend/src/canvas/Inspector.tsx` (lines 18-31, 40-70, 72-168, 221-290) - current React inspector structure, sections, chips, settings, pins.
3. `frontend/src/index.css` (lines 1-44, 308-319) - current token setup and mobile inspector wrapper; no desktop inspector CSS classes.
4. `DESIGN.md` (lines 60-83, 112-119, 186-199) - design intent for layered live inspection, selected-node inspector, and live values.
5. `CLAUDE_DESIGN_PROMPT.md` (lines 20-35, 63-69, 89-103) - original UI brief: right inspector contents, live value priority, room for sparklines, pin types.

## Key Code

### Original standalone inspector styling/behavior
The standalone design had a dedicated class-based inspector system in `C:\Users\bas\Downloads\Reactive Wire (standalone).html` line 180:

```css
.rw-inspector { width: 312px; flex: none; background: var(--rw-panel); border-left: 1px solid var(--rw-line); display: flex; flex-direction: column; min-height: 0; }
.rw-inspector.collapsed { width: 28px; }
.rw-insp-hd { display: flex; align-items: center; gap: 9px; padding: 13px 14px; border-bottom: 1px solid var(--rw-line); }
.rw-insp-collapse { width: 24px; height: 24px; border: 0; background: transparent; border-radius: 6px; cursor: pointer; }
.rw-insp-scroll { flex: 1; overflow-y: auto; padding: 4px 14px 24px; scrollbar-width: thin; scrollbar-color: var(--rw-line) transparent; }
.rw-insp-healthrow { display: flex; align-items: center; gap: 8px; padding: 12px 0 4px; }
.rw-insp-sect { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--rw-faint); padding: 18px 0 8px; border-top: 1px solid var(--rw-line-soft); margin-top: 14px; }
.rw-insp-val { margin-bottom: 12px; }
.rw-bigval { font-family: var(--mono); font-size: 21px; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; }
.rw-spark { background: var(--rw-panel2); border-radius: 8px; border: 1px solid var(--rw-line-soft); padding: 8px 10px; position: relative; }
.rw-cfg-grid { display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; }
.rw-input { height: 30px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--rw-line); background: var(--rw-panel2); font-family: var(--mono); font-size: 12px; }
.rw-pinlist { display: flex; flex-direction: column; gap: 5px; }
.rw-pinlist-h { font-size: 9.5px; color: var(--rw-faint); text-transform: uppercase; letter-spacing: .05em; }
.rw-pinlist-row { display: flex; align-items: center; gap: 9px; font-size: 11.5px; color: var(--rw-dim); }
```

Key original design traits:
- Collapsible right panel (`.rw-inspector.collapsed`, `.rw-insp-collapse`, `.rw-insp-expand`).
- Header with icon/title/subtitle plus an explicit collapse affordance.
- Empty state centered with a 52px glyph card.
- Health/memory row below the header, separate from title chrome.
- Section headers use top separators (`border-top: var(--rw-line-soft)`) and larger vertical rhythm (`18px 0 8px`, `margin-top: 14px`).
- Live values are presented as large primary values (`.rw-bigval`, 21px mono), with error/unavailable/stale variants.
- Value history sparkline is a card (`.rw-spark`) with `panel2` background, soft border, and internal padding.
- Settings use compact grid rows (`.rw-cfg-grid`, `.rw-cfg-row`) and consistent `.rw-input` controls.
- Pins are grouped/listed with small headings and type chips.
- Inspector scrollbar was explicitly subdued.

### Current React inspector
`frontend/src/canvas/Inspector.tsx` currently implements the inspector almost entirely with inline Tailwind utilities:

```tsx
const sectionTitle = "text-[10px] font-bold tracking-[.08em] uppercase text-rw-faint pt-4 pb-2";
```

Current selected panel starts at `Inspector.tsx` lines 91-99:

```tsx
<aside className="w-[312px] flex-none bg-rw-panel border-l border-rw-line flex flex-col min-h-0">
  <div className="flex items-center gap-[9px] px-[14px] py-[13px] border-b border-rw-line">
    ...title/subtitle...
    {isMacro && macroMemory && <MemBadge />}
    <HealthDot health={health} />
  </div>
```

Current live values at lines 137-160 are compact rows, not large primary values:

```tsx
<div className={sectionTitle}>Live value</div>
<div className="flex flex-col gap-2">
  {node.outputs.map((p) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-rw-dim">{p.label || p.id}</span>
      <ValueChip value={results.outputs[`${node.id}:${p.id}`]} unit={p.unit} />
    </div>
  ))}
</div>
```

Current pins at lines 272-288 are one combined list with arrows, not grouped input/output headings:

```tsx
<div className={sectionTitle}>Pins</div>
<div className="flex flex-col gap-1.5">
  {node.inputs.map(... ↦ ... <TypeChip />)}
  {node.outputs.map(... ↤ ... <TypeChip />)}
</div>
```

`frontend/src/index.css` only has mobile wrapper behavior for the inspector (`.rw-inspector-wrap`, lines 308-319); desktop inspector styling from the original is not present.

## Architecture
- The current inspector is a React component receiving selected `NodeData`, evaluation `results`, HA `entities`, value `history`, macro library, and callbacks (`onConfig`, `onSetValue`, `onEditMacro`).
- It renders inside `App.tsx` at `frontend/src/App.tsx` lines 1183-1184 within `.rw-inspector-wrap`.
- Live output values come from `results.outputs[nodeId:pinId]` and display through `ValueChip`; historical samples come from `use-value-history` and display through `Sparkline`.
- Editable literal/default values are delegated to `NodeValueEditors`, while node-specific config controls are inline in `Inspector.tsx`.
- Global design tokens in `index.css` map Tailwind `rw-*` colors to runtime CSS vars, so either Tailwind utilities or restored `.rw-insp-*` classes can share the same theme.

## Differences / Findings

### High severity: current inspector lost collapsibility
- Original: `.rw-inspector.collapsed { width: 28px; }`, `.rw-insp-collapse`, `.rw-insp-expand` in standalone line 180.
- Current: no collapsed state or collapse button in `Inspector.tsx` lines 72-290; only mobile bottom sheet can hide/show.
- Impact: desktop canvas cannot reclaim right-side space, despite original design explicitly supporting it.

### Medium severity: live values are less prominent now
- Original: `.rw-bigval` 21px mono with error/unavailable/stale variants, making selected-node output the visual focus.
- Current: live values are small row `ValueChip`s (`Inspector.tsx` lines 137-151), similar weight to settings/pin rows.
- Impact: violates the design note that live values are the headline feature (`CLAUDE_DESIGN_PROMPT.md` lines 63-69; `DESIGN.md` D6).

### Medium severity: section hierarchy is flatter
- Original: `.rw-insp-sect` included top soft separators and larger section spacing.
- Current: `sectionTitle` only has `pt-4 pb-2`, no separator (`Inspector.tsx` line 18).
- Impact: Settings, value history, and pins visually run together, especially for nodes with many controls.

### Medium severity: health/memory information moved into cramped header chrome
- Original: separate `.rw-insp-healthrow` with status label and memory label.
- Current: `HealthDot` and optional `MemBadge` sit at the far right of the header (`Inspector.tsx` lines 97-98).
- Impact: less explanatory than original; only a dot/badge, no textual status row.

### Low severity: pin list grouping regressed
- Original: `.rw-pinlist-h` headings and `.rw-pinlist-row` rows.
- Current: inputs and outputs are merged under one `Pins` section with arrow glyphs (`Inspector.tsx` lines 272-288).
- Impact: still usable, but less scannable and less aligned with original input/output type inspection.

### Low severity: original class system is absent from current CSS
- Original had reusable `.rw-insp-*`, `.rw-cfg-*`, `.rw-input`, `.rw-pinlist-*` classes.
- Current uses repeated Tailwind strings for inputs and rows in `Inspector.tsx` lines 176-239.
- Impact: harder to restore consistent visual rhythm and hover/focus/scrollbar details without repetition.

## Concrete implementation brief

1. Restore a desktop collapsible inspector shell.
   - Add local collapsed state in the owner (`App.tsx`) or inside `Inspector.tsx` if only visual.
   - Use classes equivalent to original: `.rw-inspector`, `.rw-inspector.collapsed`, `.rw-insp-collapse`, `.rw-insp-expand`.
   - Keep current mobile `.rw-inspector-wrap` behavior; ensure collapsed width is desktop-only or does not conflict with `width: 100% !important` in `index.css` lines 315-319.

2. Move inspector styling into `frontend/src/index.css` rather than expanding Tailwind strings.
   - Add a desktop inspector block based on standalone `.rw-inspector` / `.rw-insp-*` rules.
   - Convert the root aside/header/scroll area to class names while retaining Tailwind for isolated component-specific details if desired.

3. Rework live value section to match original hierarchy.
   - For a single output, render a large value row/card using a new `BigValue` wrapper or a `ValueChip` variant (`large`/`inset`).
   - For multiple outputs, keep labels but increase value prominence and spacing (`.rw-insp-val`, `.rw-bigval` style).
   - Preserve `DeviceClassIcon` for entity `state` outputs.
   - Ensure error/unavailable/stale are distinct; if `ValueChip` already handles this, expose a large visual variant rather than duplicating logic.

4. Restore section separators and scroll styling.
   - Replace `sectionTitle` with `.rw-insp-sect` semantics: top border except first section/after health row.
   - Add `.rw-insp-scroll` scrollbar styling from original.

5. Add a health/memory summary row below the header.
   - Keep `HealthDot`, but add text label (`ok`, `warning`, `error`, `stale`) using `.rw-health-label` colors.
   - Move or duplicate macro memory state into a `.rw-mem-label` row for clarity.

6. Make history a card.
   - Wrap each `Sparkline` in a `.rw-spark`-like card if the current `Sparkline` component does not already own this styling.
   - Avoid double-card styling: inspect `frontend/src/components/Sparkline.tsx` before adding wrappers.

7. Split pin list into Inputs and Outputs groups.
   - Under `Pins`, render `Inputs` and `Outputs` headings (`.rw-pinlist-h`) only when non-empty.
   - Rows use `.rw-pinlist-row`; keep existing `TypeChip`.

8. Normalize settings controls.
   - Add `.rw-input` class and use it for repeated text/number inputs.
   - Optionally use `.rw-cfg-grid` for short label/control pairs like duration unit and date shift direction.

## Risks / constraints
- The standalone HTML is bundled into a single very long line; original component markup is harder to cite than CSS, but the CSS clearly documents intended structure.
- Current React component has newer features absent/unknown in the standalone design: macros, `NodeValueEditors`, fetch/duration/date controls, and mobile bottom-sheet behavior. Restoration should be visual/structural, not a rollback of functionality.
- Adding collapsibility likely needs parent layout state if keyboard/mobile interactions or persistence are desired; doing it only inside `Inspector.tsx` may be insufficient if `.rw-inspector-wrap` still occupies width.
- Large live values need careful handling for nodes with many outputs; use a large treatment for one/few outputs and compact-but-separated rows for many-output entity nodes.
- CSS `color-mix(in oklab, ...)` is already used throughout the app, so compatibility risk is existing/accepted.

## Start Here
Open `frontend/src/canvas/Inspector.tsx` first. It contains nearly all current inspector structure and is the right place to introduce restored class names, live-value hierarchy, health row, and grouped pins. Then add the missing desktop `.rw-inspector` / `.rw-insp-*` styles to `frontend/src/index.css` near the existing mobile inspector wrapper.

## Supervisor coordination
No supervisor decision was needed; this was a read-only research task.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings include file paths and severity levels under 'Differences / Findings', with original evidence from C:\\Users\\bas\\Downloads\\Reactive Wire (standalone).html line 180 and current evidence from frontend/src/canvas/Inspector.tsx and frontend/src/index.css."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "find/read/grep on design notes, Inspector.tsx, index.css, and standalone HTML",
      "result": "passed",
      "summary": "Located current inspector implementation, mobile CSS, design notes, and original standalone inspector CSS."
    },
    {
      "command": "node scripts via bash to search/extract standalone HTML snippets",
      "result": "passed",
      "summary": "Searched the bundled standalone HTML and extracted the original .rw-inspector/.rw-insp-* CSS around byte offsets containing inspector styling."
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "Standalone HTML is bundled on one giant line, so original CSS is cited as line 180 rather than precise multi-line ranges.",
    "No browser visual comparison was performed; findings are based on source/design inspection."
  ],
  "noStagedFiles": true,
  "notes": "Read-only task honored; only the requested analysis artifact was written."
}
```
