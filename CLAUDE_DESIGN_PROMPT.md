# Claude Design prompt — Reactive Wire editor UI

> Copy everything in the fenced block below into Claude design.

```
You are designing the UI for "Reactive Wire" — a node-based visual editor for building
REACTIVE Home Assistant automations. Think "Node-RED, but typed and reactive." Instead of
imperative flows that pass messages, users build a graph where every wire carries a typed,
always-current value (a "behavior"), and an entity's desired state is DERIVED from the
combined current state of other entities and data sources. Changes propagate automatically.

Design a clean, modern, information-dense-but-legible web app. It will be built with React
Flow (@xyflow/react), so favor layouts that suit an HTML/SVG node canvas. Dark-mode-first,
with a light variant. The aesthetic: technical, calm, trustworthy — this controls a real
home, so it should feel precise, not toy-like. Prioritize at-a-glance comprehension of the
whole graph (Node-RED's best quality) while making types and live values obvious.

## The core idea to communicate visually
1. ONE wire type (behaviors), COLOR-CODED BY VALUE TYPE: boolean, number, string, Color,
   and an "unresolved/any" style (grey/striped) for generic pins not yet connected.
2. LIVE VALUES are the headline feature. Every output pin shows its current runtime value as
   an always-on chip. The canvas is a live view of a running system, not a static diagram.
3. Honesty: the graph should never hide what's flowing. Types are visible on every pin;
   nodes that hold internal state are visibly marked.

## Screens / states to design
A. Main editor: left sidebar + node canvas + right inspector + top toolbar.
B. A node in its several forms (see node anatomy).
C. Live value display: value chips on pins; selected-node inspector panel.
D. Edit/deploy controls and the draft-vs-live + dry-run states.
E. Macro (custom node) definition canvas with Input/Output boundary nodes.
F. Empty state / first-run.

## Layout
- TOP TOOLBAR: app name; a Deploy button; an "Auto-deploy" checkbox; a clear DRAFT vs LIVE
  status indicator; undo/redo; zoom controls.
- LEFT SIDEBAR: searchable NODE PALETTE grouped by category (Entities, Logic, Math,
  Compare, Constants, Sinks, Macros); a list of the user's FLOWS; a list of their MACROS.
- CENTER: the node CANVAS (pan/zoom, dotted-grid background, smooth wires).
- RIGHT INSPECTOR (collapsible): for the selected node — its current output value(s),
  config/widgets, and pin types. Leave vertical room for a future sparkline of value history.

## Node anatomy (design these variations)
- Base node: title header + type label; INPUT pins on the LEFT, OUTPUT pins on the RIGHT;
  every pin labeled and COLORED BY TYPE; each output pin shows an always-on VALUE CHIP with
  the current value.
- Entity source node: represents one HA entity; exposes MANY output pins — one per
  attribute/state (e.g. a light: on(bool), brightness(number), color(Color), color_temp(
  number)). These nodes can be tall; design for a scannable pin list.
- Variadic node (AND / OR / SUM): an AUTO-GROWING input list — always one empty trailing
  input pin; connecting it makes a new empty one appear. Show this growth clearly.
- Generic node (Select / "if"): pins start as "unresolved/any" (grey/striped) and RECOLOR to
  the resolved type once the first wire connects.
- Stateful node (edge-detect, toggle, fold, dedup): carries a small "HAS MEMORY" badge
  (e.g. a clock or chip/memory glyph) so users can see which nodes hold state.
- Constant nodes: inline editing widgets — number field, boolean toggle, text field, and a
  COLOR PICKER for the Color constant.
- Sink node (e.g. a light): a reconciling writer. Must show two states: DRY-RUN preview
  ("would call light.turn_on(red)") while editing, vs "called/live" when deployed.

## Live value inspection (most important)
- Always-on value chips on output pins. Keep them compact and legible even when many wires
  cross. Booleans could render as a filled/empty dot or true/false; numbers as the value
  (+unit if known); Color as a swatch; strings truncated.
- Selecting a node opens the right inspector with the full current value, the node's config,
  and its pin types.
- Wires are colored by type (not by value). Consider a subtle flow/pulse animation to convey
  "live," but keep it calm.

## Edit / deploy model (design the states)
- Live preview is ALWAYS on while editing (values flow through the draft).
- Sinks are DRY-RUN during editing (show what they would do) unless deployed/auto-deploy.
- Auto-deploy checkbox in the toolbar; explicit Deploy button; a prominent DRAFT vs LIVE
  indicator so users always know whether their house is currently being controlled.

## Macros (custom reusable nodes)
- A "Group into node" action turns a selection into a reusable macro.
- A MACRO DEFINITION CANVAS: like the main canvas but with explicit typed INPUT and OUTPUT
  boundary nodes that define the macro's pin signature.
- Macros appear in the palette; design how a placed macro looks (compact, with its typed
  pins, and a memory badge if it contains stateful nodes).
- Show an Export/Import affordance for sharing a macro as a file.

## Error & invalid states (design these — errors are a constant background condition)
This graph runs live on top of Home Assistant, which changes underneath it (devices go
offline, attributes disappear, entities get renamed). Absence/error is a VALUE that flows,
not a rare exception. Design a clear visual language for it:
- Value chips must show "unavailable" and "error" DISTINCTLY (never blank, never a fake
  value). E.g. a muted "—/unavailable" chip and a red "error" chip with an icon.
- ERROR PIN: when a wire references an attribute/entity that no longer exists (e.g. a light
  that stopped exposing `brightness`), the pin stays but renders as a GHOST/MISSING pin
  (red, dashed, "missing: brightness") with a tooltip diagnostic — it is NOT deleted.
- NODE HEALTH BADGE: ok / warning / error indicator on each node, legible even when zoomed
  out so a broken node is spottable in a large graph.
- "PROBLEMS" PANEL: an IDE-style list of all current issues, split into structural
  (edit-time) vs runtime (live), each click-to-focus its node.
- CONNECT-TIME REJECTION: when a user tries an invalid connection (type mismatch, would
  create a cycle), show a brief explanatory toast/affordance — don't just silently refuse.
- DEPLOY GUARD: a pre-deploy summary that blocks on hard errors and warns on soft/degraded.
- HA-DISCONNECTED state: a global banner; all values shown stale/greyed with last-known +
  timestamp; controls indicate no actuation is happening while disconnected.

## Concrete example to render on the canvas (use this to make mockups real)
"When the sun is down AND someone is in the room, set the living-room light to red;
otherwise turn it off."
Graph:
- [sun.sun] entity node — use its `elevation` (number) output pin.
- A [ < 0 ] compare node → boolean "sun is down".
- [binary_sensor.room_presence] entity node — `state` (boolean) output pin.
- An [AND] variadic node combining the two booleans → drives the light's `on` pin.
- A [Color: red] constant node (with color swatch) → drives the light's `color` pin.
- [light.living_room] sink node, accepting `on` (boolean) and `color` (Color), shown in
  dry-run ("would call light.turn_on(rgb 255,0,0)").
Show live value chips on every pin (e.g. elevation = -4.2, sun-is-down = true,
presence = true, AND = true, color = red swatch).

## Deliverables
- The main editor screen (populated with the example above), in dark mode.
- Close-ups of: an entity node with many pins; a variadic AND mid-growth; a generic Select
  with an unresolved pin; a stateful node with its memory badge; a constant Color node with
  picker; a sink node in dry-run vs live.
- The right inspector panel for a selected node.
- The macro definition canvas with Input/Output boundary nodes.
- The toolbar showing DRAFT vs LIVE and the auto-deploy checkbox.
- ERROR STATES: a node with a ghost/missing pin (attribute removed); value chips showing
  unavailable vs error; the Problems panel; the HA-disconnected banner with stale values.
- A short note on the color system used for the value types AND for the health/error states.
```
