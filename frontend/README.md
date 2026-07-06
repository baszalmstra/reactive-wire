# Reactive Wire — editor frontend

The visual editor for Reactive Wire. There's an openable in-browser app (a pan/zoom/drag
canvas running the canonical graph with live values) plus a Storybook component library.

**Styling is Tailwind v4.** The design's OKLCH tokens (from the Claude Design handoff) are
registered in `@theme` in `src/index.css`, referencing the runtime `--rw-*` variables that
`../shared/theme.ts` sets per aesthetic × mode — so utility classes like `bg-rw-node` /
`text-rw-text` follow the active theme. Three aesthetics (IDE / Blueprint / Warm) × light/dark.

Typefaces are self-hosted (no CDN): Hanken Grotesk for the UI and IBM Plex Mono for values
and identifiers, pulled in from `@fontsource` in `src/main.tsx`.

## Commands

Run everything through pixi from the **project root** (it installs deps as needed and uses
the pinned Node toolchain):

```sh
pixi run fe-dev           # open the editor app at http://localhost:5173 (live canvas)
pixi run storybook        # explore components (aesthetic + light/dark toggles in the toolbar)
pixi run build-storybook  # static Storybook build
pixi run fe-build         # production build of the app
pixi run fe-typecheck     # type-check the editor
```

Switch aesthetic and light/dark from the Storybook toolbar — both are global toggles applied
by the theme decorator.

## Components

- `ValueChip` — a pin's current value; renders bool/number/string/Color plus `unavailable`,
  `error`, and `stale` distinctly. Three anatomies: chips / inset / minimal.
- `Pin` — a typed connection point: color-coded knob + label, value chip on outputs.
  Handles `any` (unresolved), `ghost` (missing attribute), variadic, and hot-target states.
- `Badges` — `HealthDot` (ok / warn / error) and `MemBadge` (has internal state).
- `Widgets` — `ColorWidget` (inline color picker) and `SinkPanel` (dry-run vs live).

## Layout

```
src/
  App.tsx             editor shell; wires the toolbar, canvas, and inspector together
  main.tsx            app entry; loads fonts + index.css and mounts <App>
  index.css           Tailwind v4 setup, @theme tokens, and component styles
  canvas/             React Flow nodes, inspector, palette, macros, validation
  components/         presentational components + a *.stories.tsx per component
  state/              editor-document, collab, undo/redo, flows, and comment-frame hooks
  example/            seed graph and the offline entity simulation
../shared/            model code shared with the server:
  theme.ts            design tokens; buildThemeVars(aesthetic, mode)
  value.ts            view-side value model + formatting
  node-types.ts       node/pin data model and geometry
  results.ts          resolved pin values + per-node health
.storybook/           Storybook config + theme decorator
```
