# Reactive Wire — Design Document

> A node-based **reactive** automation system for Home Assistant: a typed, inspectable
> graph where an entity's state is *derived* from the combined state of other entities
> and data sources, rather than imperatively scripted through transitions.

**Status:** Living document — design grilling complete; now tracking implementation.
**Last updated:** 2026-06-15

> **Quick orientation:** §3 records the original design decisions. Some evolved during
> implementation — see **§3.1**. The **current, accurate architecture** is **§8**. The
> consolidated **roadmap / TODO** is **§9**.

---

## 1. Motivation & Problem Statement

Existing options and why they fall short for the user:

- **HA YAML automations** — imperative; modeling combined-state conditions forces you to
  enumerate transitions ("when sun sets AND person present", "when person enters AND sun
  already down", ...). Painful and error-prone.
- **Node-RED** — strong points we want to keep:
  - Visual graph you can *inspect live* (see current state of the flow).
  - Easy overview / comprehension.
  - Custom nodes usable as reusable macros.
  - Weak points we want to fix:
  - Largely **untyped**; communication via `msg` objects that must be parsed; the wire
    tells you nothing about what flows through it.
  - **Imperative / message-driven**; combining multiple event sources into one derived
    output is awkward.
- **Python (AppDaemon/pyscript)** — flexible but no visual overview, still imperative.

### Canonical example (the thing that must be easy)
> If the **sun is down** AND **someone is in the room** → light = **red**.
> If the **sun is up** → light **off** (don't touch it).
> If the sun goes down while a person is *already* in the room → light turns on.

The key insight: this should be expressed as a **pure derivation** of the light's desired
state from `(sun_state, presence_state)`. No transition modeling. Any input change
re-derives the output.

---

## 2. Goals & Non-Goals

### Goals
- **Reactive / declarative dataflow**: output = f(current inputs); propagation is automatic.
- **Typed ports**: wires carry typed values; the editor enforces and visualizes types.
- **Visual graph editor** (first-class, high priority): drag nodes, connect typed ports,
  edit params, and **inspect live runtime values directly on the canvas**.
- **Custom/reusable nodes** ("macros"): compose subgraphs into reusable typed nodes.
- **Single stack** (TypeScript end-to-end) for runtime + editor.
- **Modern standards & tooling**; reproducible env via **pixi**.

### Non-Goals (for the prototype)
- Production hardening, multi-user, auth beyond a long-lived HA token.
- Full parity with Node-RED's node catalog.
- (TBD) Whether we ever run *inside* HA as an add-on vs. standalone service.

---

## 3. Key Decisions (resolved)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Language / stack | **TypeScript, single stack** | Editor is first-class & web-based; keep runtime + UI in one language/ecosystem. |
| D2 | Reactive vs imperative | **Reactive (derived state)** | Core thesis; eliminates transition modeling. |
| D3 | Env / reproducibility | **pixi** (manages Node.js toolchain from conda-forge + tasks) | User constraint; reproducible. |
| D4 | Prior-art research | Mandatory before committing to libs | User constraint; avoid reinventing. |
| D5 | Editor library | **React Flow (`@xyflow/react`)** + React/TS/Vite | Mature, pure-UI (BYO runtime), live inspection = component state. |
| D6 | Live value inspection | **Layered (option d)**: always-on port-anchored value chips + selection inspector; wires **color-coded by type**; current-value-only for prototype (sparkline-ready). | Keeps Node-RED's at-a-glance strength; cheap with React Flow. |
| D7 | Custom node model | Shareable nodes = **pure subgraph macros**, serialized as **JSON**. Trusted built-in code "primitives" ship with the project. Arbitrary user code nodes deferred behind a trust gate. | Safe-by-default sharing (no code exec on import); declarative & versionable. |
| D8 | Node distribution | **JSON export/import now**; **conda packages for versioned nodes later** (fits pixi/conda stack). | Quick start, clean upgrade path. |
| D21 | Editor styling | **Tailwind CSS v4 + shadcn/ui** (Radix-based copy-in components: dialogs, dropdowns, the auto-deploy checkbox, etc.). Dark-mode-first; unopinionated look we control; pairs cleanly with custom React Flow nodes. | Modern de-facto standard; full control of the node-canvas look while getting accessible primitives for free. |
| D9 | Runtime topology | **Headless server is the source of truth** (option b, built immediately — not staged). The **server** owns the HA WebSocket connection, runs the flows 24/7, and calls services. The **editor is a live view** that loads/saves graph JSON and subscribes to the server's node/wire values. Reactive **engine is one shared TS module** imported by the server (and reused by the editor for type-checking/preview). | Always-on automation is the actual goal; canvas = view over runtime state. |
| D10 | Reactive engine | **Signals core** (recommended **alien-signals**, fallback `@vue/reactivity`) for glitch-free, topologically-ordered, lazy propagation. RxJS only at async edges, never the core. | Signals are the only family giving glitch-free diamond propagation for free (§5.2). |
| D11 | **Behaviors-only wires + stateful nodes** | The graph has **one wire type: behaviors** (continuous, always-current values). No separate "event" wire type. The event-ish residue (edge/`rising`, `scan`/`fold`/toggle, dedup, `hold`) collapses into **nodes with local state** — analogous to React: pure node = `useMemo`, stateful node = `useState`/`useReducer`/`usePrevious`. Implemented as a writable signal updated by an effect over inputs. Editor marks stateful nodes with a "has memory" badge so the graph stays honest. | Maximally reactive & one honest wire type; pushes durations/timers (time is a behavior) and reconcilable actions into pure derivation; confines memory to where it's irreducible. Driven by user's "it's local state, like useState" insight. |

| D12 | Type system | **Primitives only: `boolean`, `number`, `string`** — plus a **`Color`** type (light color is central). **No enums** for now (strings cover HVAC modes, light effects, etc.). Nominal semantic types (Brightness/Kelvin) and HA-domain entity types are **rejected** for the prototype. Connection rule: exact-type match or explicit conversion node (no silent coercion). Wires colored by type. | User wants minimal; primitives are enough to start; Color earns its own type because it's the headline use case. |
| D13 | Entity nodes | **Each HA entity is a node; each attribute (and its state) is exposed as its own typed output pin.** The node introspects the entity and emits one pin per attribute. Pin types via best-effort parse at the boundary: numeric→`number`, on/off/home/etc.→`boolean`, color attrs→`Color`, else `string`. (This *is* the "parse HA's stringly-typed states into typed behaviors" layer.) | Node-RED-like clarity but typed; no need to pre-model HA domains as types — the node self-describes from the live entity. |

| D14 | Variadic & generic pins | **Variadic (n-ary) inputs** for associative/commutative reducers (`AND`, `OR`, later `SUM`/`MIN`/`MAX`/`CONCAT`) via **auto-growing pins** (always one trailing empty input; connecting it spawns the next). Kept **homogeneous** (all inputs same type). **Genericity only as connect-time pin resolution**: "open"/`any` pins lock to a concrete type on first connection (covers generic `Select`/`if`, passthrough, `hold`). **Full macro-level type parameters stay deferred** (refines D12). | Directly attacks the core pain (combining many conditions cleanly); cheap to implement (engine folds over connected inputs); avoids a real generic type system while still typing `Select`. |

| D15 | Edit/deploy model | **Hybrid, user's choice.** Live **preview always on** while editing (values flow through the draft; sinks run **dry-run** = show what they *would* write). An **auto-deploy checkbox**: when on, edits apply to the live actuating engine immediately; when off, changes go live only on an explicit **Deploy**. Already-deployed graph keeps running untouched until (auto-)deploy. Default: manual deploy (safe). | Satisfies live-value inspection (D6) and always-on safety (D9) simultaneously; lets power users opt into live-edit immediacy. |

Editor implications of D15: **Deploy button**, **auto-deploy checkbox**, **draft-vs-live
indicator**, and **dry-run sink visualization** ("would call `light.turn_on(red)`" in
preview vs "called" when live).

Editor implications of D14: render a **dynamic handle count** per node; spec the
"empty trailing pin fills → new empty appears" interaction; `any`/unresolved pins need a
distinct visual that recolors on resolution; serialization stores **per-node pin lists**
(resolved types + wire→pin mapping), since arity is no longer fixed by node type.

| D16 | Macros (custom nodes) | **Authoring = (c):** group-selection convenience that drops into a **definition canvas** with explicit typed **Input/Output boundary nodes** (Node-RED subflow model). A macro is *just a subgraph* → inherits reactive semantics for free. **Macro = type; each placement = independent-state instance** (React-component model): N placements of a stateful macro = N independent states. Editing the definition updates all instances' behavior; their runtime state stays separate. A macro containing memory is itself stateful (gets the "memory" badge). **Shared macros: editable/forkable on import** (default; locking deferred to conda-package era, D8). | Matches what the user values in Node-RED; correct state isolation; clean typed interface for sharing. |

| D17 | Cycles / feedback | **Strict DAG.** Editor **rejects connections that would create a cycle** (`isValidConnection` reachability check). Feedback is handled **inside nodes, not via wires**: reconciling sinks read actual state internally to diff; stateful nodes seed from the world at boot. **Echo safety:** sinks act only when desired changes AND actual ≠ desired (self-write echoes are no-ops). Genuine cyclic feedback (rare) → explicit **`previous`/unit-delay** stateful node later. | Keeps the signals core glitch-free & simple; avoids oscillation; matches how reconcilers actually work. |

### 3.1 How decisions evolved during implementation

- **D10 (reactive engine) — superseded.** We did **not** ship a signals core. During
  implementation we consolidated onto a **single pure-recompute engine** (`evaluate`), made
  **Kleene-correct** for 3-valued logic, used by **both** the editor (preview) and the server
  (actuation). Signals' only edge here (lazy/glitch-free) is irrelevant at home-automation
  graph sizes, and one shared pure engine removed a graph-translation layer and the
  two-engine drift. (`@vue/reactivity` is no longer used by the runtime.) See §8.
- **D22 (editable pin values) — added.** A pin may carry an editable literal value
  (`PinDef.editable`, stored in `NodeData.values[pinId]`). One mechanism, three uses: an
  **input default** when unconnected, a **constant's** output literal, and **compare's**
  operands. This generalized/replaced the per-node constant + compare widgets. See §8.
- **D6 / D9 (live values) — refined.** The editor computes its live preview **in-browser**
  (`evaluate`) from the server's streamed **entity feed**, rather than subscribing to
  server-*computed* pin values. The server runs the same engine independently for actuation.
  Streaming server-computed values (so the editor is a pure view) remains a possible refinement.
- **D12 (Color representation, Q4a) — resolved:** `Color` is a hex string (`#rrggbb`);
  HA `rgb_color` arrays are parsed to/from it.

**How we push the "event" residue into behaviors (worked through with user):**
- **Conditions/durations** → always behaviors. *Time is the canonical behavior*, so
  `now() - entity.last_changed > T` covers "open for 10 min", "no motion for 5 min", etc.
- **Reconcilable actions** → behaviors via *desired-state + idempotent reconciling sink*
  (diff desired vs actual, act only on diff; re-asserting is a no-op → restart-safe). Covers
  lights/climate/covers/volume AND addressable notifications (`persistent_notification`,
  `input_boolean` "alert active", `input_select`).
- **Irreducible residue** = *transient fire-and-forget effects with no queryable state*
  (push notification, **TTS announcement**, chime, run-script-once) + *history-folds*
  (toggle, cycle-scenes). Both bottom out in one primitive: **react to a behavior's
  *change*, not its value** → a stateful node. Restart-safe by seeding at boot.

---

## 4. Open Questions (the grilling queue)

Tracked as we go. ✅ = resolved, ⏳ = in progress, ⬜ = not yet discussed.

- ✅ **Q1 Substrate/runtime** → TypeScript/web single stack (D1).
- ⏳ **Q2 Visual editor requirements** → live-value inspection resolved (D6); more in §6.
- ✅ **Q3 Reactive model**: **behaviors-only wires + stateful nodes** (D10, D11). One wire
  type; "events" = nodes with local state (React `useState` analogy).
  - ✅ **Q3a Local-state persistence policy**: each stateful node declares one of
    *seed-at-boot* (default, ephemeral — edge detectors), *durable* (kept verbatim across a
    restored memory map — folds), or *reseed-from-world* (boots from a configured entity's live
    value — toggle ← light's actual state). Built in §9. The *durable* on-disk save/restore
    half depends on persistence (Q9).
- ✅ **Q8/Q8b Custom nodes + sharing** → D7 (subgraph macros, JSON) + D8 (conda later).
- ✅ **Q4 Type system**: primitives (`boolean`/`number`/`string`) + `Color` (D12). Entities
  as nodes with one pin per attribute (D13).
  - ✅ **Q4a `Color` representation** → hex string `#rrggbb` (D12 / §3.1).
- ✅ **Q5 Runtime ↔ editor relationship** → D9 + §3.1: headless server runs the engine and
  owns HA; the editor previews in-browser from the streamed entity feed and deploys over WS.
- ✅ **Q6 HA integration** → `subscribeEntities` feed + `callService` (built; §8).
- ✅ **Q7 Node catalog (MVP)**: entity source, light sink (reconciling), constants, compare,
  logic (`AND`/`OR`/`NOT`), sum, select. _Build pending:_ time/`now` + duration, edge/hold/fold.
- ⬜ **Q9 Persistence / format**: graph serialization + editor save/load + server
  reload-on-restart. **Not built — the recommended next step** (see §9).
- ⬜ **Q10 Execution location & lifecycle**: when does the graph run? Headless vs needs editor open?
  - ✅ Topology = D9 (headless server is source of truth).
  - 🎯 **Future goal: ship as a Home Assistant add-on** (Supervisor-managed Docker
    container). Implication: keep the server **containerizable** (Docker image; pixi can
    produce it), config via add-on options (HA URL/token via Supervisor API / `SUPERVISOR_TOKEN`),
    and assume an ingress-proxied web UI. Don't paint ourselves out of this.
- ✅ **Q11 Feedback loops / cycles**: strict DAG; feedback inside nodes; echo-safe sinks (D17).
- ✅ **Q12 Errors & invalid state**: errors-as-values + sink safety (D18), schema-drift/dangling
  refs (D19), error UX (D20). See §7.

---

## 5. Prior Art Research (complete)

> Findings from three research streams: reactive paradigms (signals vs RxJS vs FRP), node-graph
> editor libraries, and HA automation prior art + `home-assistant-js-websocket`.
> Note: §5.2 recommended a signals core, but implementation consolidated onto a pure engine —
> see §3.1.

### 5.1 Node graph editor libraries (✅ research complete)

**Recommendation: React Flow (`@xyflow/react`).** Most mature/maintained (v12, MIT,
~37k★, June 2026), **pure UI / bring-your-own-runtime** (exactly our need), first-class
TS, trivial JSON serialization, and nodes-are-React-components → live value chips and
wire labels are just component state. Typed ports are a ~30-line DIY concern
(`isValidConnection` + color handles/edges), which is fine since we own the type model.

- **Runner-up: Rete.js v2** — framework-agnostic, **typed sockets + optional dataflow
  engine out of the box**, steeper API. Pick if we want to stay framework-agnostic.
- **Baklava.js** — best if we commit to Vue (built-in interface-types + optional engine).
- **Avoid for a growing prototype:** original LiteGraph (dormant; lively fork captive to
  ComfyUI), Drawflow (no typed connections), Flume (authoring-focused, weak live
  inspection).

Implication for **Q2 (live value inspection)**: with React Flow, port-anchored value
chips (option a) and wire labels (option b) and an inspector panel (option c) are all
just React state — confirms option **(d)** is cheap. Color wires by **type** via custom
edges.

Implication for stack: **React + TypeScript + Vite** is the leading candidate (see §7).

### 5.3 HA prior art & integration (✅ research complete)

**The niche is genuinely unfilled.** Existing HA tools split into:
- **Imperative / transition-modeled**: Node-RED, AppDaemon, pyscript, native YAML — react
  to *one* trigger, then manually re-fetch the *other* inputs to decide. Exactly our pain.
- **Declarative / state-derived**: HA **state-based template sensors** are the one true
  reactive primitive in core — auto-track dependencies, re-derive on *any* input change.
  But: text/Jinja only (no visual graph), dynamically typed, and they derive *values* only
  (acting requires bolting on a separate automation).

**Our whitespace = reactive semantics + visual graph + typed wires + unified
derivation→action.** No existing node-based HA tool is reactive (Node-RED/NoFlo/Flyde are
flow-based packet-passing, *not* dependency-tracked re-derivation); the only reactive thing
in HA is text-based templates.

**Actionable integration facts (drive Q6):**
- Build on **`subscribeEntities`** (maintained *merged current-state map*), NOT raw
  `state_changed` events. First callback is a **full snapshot** → seeds every behavior so
  outputs are defined from t=0. This natively solves Node-RED's "no current value on
  connect" / cold-start gap.
- Auth: `createLongLivedTokenAuth(url, token)` + `createConnection({auth})`. Under Node we
  must provide a `WebSocket` (the lib was browser-first) — relevant to where the runtime runs.
- Actions: `callService(conn, domain, service, data?, target?)`.
- State shape: `{entity_id, state: string, attributes: {[k]: any}, last_changed,
  last_updated, context}`. **`state` is ALWAYS a string; attributes are `any`; there is NO
  per-domain typing** in the base lib. Node-RED even *deprecated* its auto-coercion because
  it misbehaved.
  → **Implication for Q4:** if typed wires are our differentiator, we must build our own
  domain-aware type layer (parse numeric sensor states; model `light`/`binary_sensor`/
  `sensor`/`sun` attribute shapes). This is real work, not free.
- Model each entity as a **behavior** (always has a current value); nodes are pure
  derivations over behaviors. Handle `null` states (entity creation/removal).

### 5.2 Reactive paradigms (✅ research complete)

**Verdict: signals core for the derivation graph + FRP behavior/event vocabulary on top.**

- **Why signals for the core:** they're the only mainstream family that gives
  **glitch-free, topologically-ordered, lazy pull-based** propagation *for free* (graph
  coloring + version/epoch counters → each node recomputes once, only after inputs settle).
  This is exactly what a derived-state graph needs and is painful to get right by hand.
- **Why NOT RxJS for the core:** RxJS is **provably glitchy on diamonds** (`combineLatest`
  emits inconsistent intermediates) — and a diamond is our *default* shape (two derivations
  recombined). RxJS is the right tool only at **async edges**.
- **Why FRP for vocabulary:** FRP is the only paradigm that formally separates
  **Behaviors/Cells** (continuous, always-current) from **Events/Streams** (discrete,
  momentary) — precisely our distinction. The bridge combinators are the key tools:
  `hold(initial)` (event→behavior), `snapshot`/`sample` (read a behavior when an event
  fires), `edge`/`rising`/`falling` (behavior→event). Note: maintained JS FRP *libraries*
  (Sodium, Bacon, Kefir) are dormant — so we **adopt the discipline, not a library**.
- **Engine choice (recommended):** **`alien-signals`** — best embeddable story
  (`createReactiveSystem()` to build our own node API on top), tiny, fastest, TS-native,
  and validated by adoption into Vue 3.6's core. Fallback: **`@vue/reactivity`** (batteries
  -included, most-maintained) if we'd rather not hand-roll primitives.
- **Async sources** (the user's "pull in different data sources"): live at the edges —
  `timer + switchMap(fetch) + write-back into a signal` → becomes a behavior with a current
  value. Keeps the core synchronous/glitch-free.
- **Validation:** this is literally how HA itself is structured — a **State Machine**
  (behaviors) + **Event Bus** (events), surfaced as state-based (auto-derived) vs
  trigger-based (event-driven) templates. We're mirroring a proven split.
- **TS prior art to study:** [`Digital-Alchemy-TS/hass`](https://github.com/Digital-Alchemy-TS/hass)
  exposes both synchronous `.state` *and* `.onUpdate()` — the exact behavior/event duality
  we want; [`home-assistant-rxjs`](https://github.com/alexciesielski/home-assistant-rxjs)
  for the pure-stream approach.

---

## 6. Visual Editor Requirements (drafting)

User will produce the visual design separately (Claude design). This section is the
self-contained spec to design against. Library: **React Flow** (D5); styled with
**Tailwind v4 + shadcn/ui** (D21).

### 6.1 Canvas & wires
- One wire type: **behaviors** (D11). Wires **colored by value type** (D12): `boolean`,
  `number`, `string`, `Color`, and an **`any`/unresolved** style (grey/striped) for open
  pins not yet connected (D14).
- Conversion between types is an explicit **adapter node**, never silent (D12).
- Wires should read cleanly when many cross — prefer port-anchored value display over
  mid-wire labels (see 6.3).

### 6.2 Node anatomy
- Header: node title + type.
- **Input pins (left), output pins (right)**, each labeled and **colored by type**.
- **Entity nodes** expose **one output pin per attribute/state** (D13), so they can be tall.
- **Variadic nodes** (`AND`/`OR`/`SUM`/…) show an **auto-growing input list**: always one
  trailing empty pin; connecting it spawns the next (D14).
- **Open/generic pins** (`Select`/`if`) start `any`-typed and **recolor to the resolved
  type on first connection** (D14).
- **Stateful nodes** (edge/fold/toggle/dedup, and any macro containing them) carry a
  **"has memory" badge** (D11, D16).
- Constant nodes have inline widgets (number field, toggle, text, **color picker** for
  `Color`).

### 6.3 Live value inspection (D6) — the headline feature
- **Always-on value chips** at each **output pin** showing the current runtime value.
- **Selection inspector panel**: current value (+ room for recent history/sparkline later),
  node config, and pin types.
- Current-value-only for the prototype; design the chip so a **sparkline** can drop in.
- Values are **pushed in from the engine** (the canvas is a *view* over runtime state, D9) —
  design components around "value arrives from a subscription," not local UI state.

### 6.4 Edit / deploy controls (D15)
- **Live preview always on** while editing; **sinks render dry-run** ("would call
  `light.turn_on(red)`") vs **"called"** when live.
- **Auto-deploy checkbox** + explicit **Deploy** button; **draft-vs-live indicator**.

### 6.5 Macros / custom nodes (D16)
- **"Group into node"** action on a selection → opens a **definition canvas** with typed
  **Input/Output boundary nodes**.
- Macros appear in the node palette; **placements are independent instances**.
- **Export/Import** a macro as JSON (with nested deps); imported macros are **forkable**.

### 6.6 Palette / catalog (MVP, Q7)
Entity source · Entity/service sink (reconciling, dry-run aware) · Constants
(number/boolean/string/Color) · Comparison (`<`,`>`,`==`,`!=`) · Logic (`AND`/`OR`/`NOT`,
variadic) · `Select`/`if` (generic). _Next:_ time/`now` + duration, stateful edge/fold.

---

## 7. Error model & invalid states (D18–D20)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D18 | Errors as values | **Every behavior is `Value<T> = Ok(T) \| Unavailable \| Error(msg)`**; non-Ok values **propagate** reactively. **Boolean ops = Kleene 3-valued** (`false AND unavailable = false`; `true AND unavailable = unavailable`). **Arithmetic = strict propagation**. **SAFETY RULE: sinks NEVER actuate on a non-`Ok` desired value** — they hold/do nothing, never write a default. | Mirrors HA's own `unavailable`/`unknown`; keeps errors reactive; prevents "offline sensor turns off all lights." |
| D19 | Schema drift / dangling refs | Reference entities & attributes by **stable id** (`entity_id` + attribute key), never pin position. Missing attr/entity → render a **ghost/error pin** (don't drop it), downstream value = `Error`. **Never auto-delete** (temporary disappearance is normal); **auto-heal** when it returns. User actions: reconnect / delete pin / leave pending. | Preserve user intent across world-flux (same principle as boot-seeding); reboots/offline devices must not shred graphs. |
| D20 | Error UX | Inline red/dashed error pins + tooltips; value chips show `unavailable`/`error` **distinctly** (never blank/fake). **Node health badge** (ok/warn/error) legible zoomed-out. **"Problems" panel** (structural vs runtime, click-to-focus). Connect-time rejections **explain themselves**. **Deploy guard**: block hard errors, warn soft. **HA-disconnected banner** + stale/greyed values + **no actuation while disconnected**. | "User interaction around errors" is first-class, not an afterthought. |

## 8. Architecture (current, as built)

Single TypeScript codebase, pixi-managed. **One engine** powers both editor preview and
server actuation. (The subsections after this map are a chronological build log; this map is
the current source of truth.)

**Shared engine — `shared/`** (single source of truth for semantics, imported by **both** the
editor and the server; the server no longer reaches into `frontend/`): a neutral, DOM-free
directory both tsconfigs include. `shared/engine/evaluate.ts` is a pure recompute over
`(nodes, edges, entityMap, memory)` → resolved `RWValue` per pin, plus per-node health, sink
display actions, and a `connected` map. Kleene 3-valued logic (D18); editable pin defaults via
`inEff` (D22); generic-type resolution via `typeGroup`; strict-DAG cycle guard (D17).
`sinkCalls()` turns sink inputs into concrete HA service calls (non-`Ok` → skipped — the safety
rule). `shared/` also holds `value.ts`, `results.ts`, `node-types.ts`, `entities.ts`, `theme.ts`,
`macros.ts`, and `engine/expand.ts` (macro inlining).

**Node registry — `shared/engine/nodes/`**: each node type is a self-contained `NodeDef` (plain
object, not a class) — its palette template, one-line description, pure `eval(ctx)`, and (for
sinks) `evalSink`. `evaluate.ts` keeps the cross-cutting machinery (Kleene helpers, generic/
variadic resolution, memory threading) and dispatches to the registry. `node-templates.ts`
derives `PALETTE` and `describeNode()` from it, so a node's presentation and behavior live in one
place.

**Server — `src/server/`** (always-on source of truth, D9):
- `index.ts` — boots `RealHA` (`HA_URL`/`HA_TOKEN`) or `MockHA` + `sim.ts`; starts the feed; holds the `Deployer`.
- `feed.ts` — WebSocket (default `:7420`): streams the live entity map; accepts `deploy` requests.
- `runtime.ts` — `Deployer`: re-runs the deployed graph with `evaluate` on every entity change and actuates sinks (preview vs live).
- `ha/` — `HAClient` + `EntityFeed` interfaces, `MockHA`, `RealHA` (`subscribeEntities` + `callService`).

**Editor — `frontend/src/`**: React + Vite + Tailwind v4 + React Flow (D5).
- `App.tsx` — wires entity feed (or offline sim) → `evaluate` → React Flow; deploy/auto-deploy; theme; connection state.
- `canvas/` — `RWNode` (custom node + typed Handles), `validation` (type + cycle), `Palette`, `Inspector`, `EntityPicker`, `NodeConfigPopup`, `NodeValueEditors`, `results-context`.
- `components/` — `ValueChip`, `Pin`, `Badges`, `Widgets` (`PinValueEditor`/`OpSelect`/`SinkPanel`), `Icon`, `NodeView` (Storybook only).
- `canvas/node-templates.ts` — re-exports the registry-derived `PALETTE`/`describeNode` plus the variadic-pin helpers (kept editor-side, depends only on `shared/`); shared types/tokens now live in `shared/`.

**Remaining root `src/`** — server-only: `server/`, `ha/` (`HAClient`/`EntityFeed`, `MockHA`,
`RealHA`), and `reactive.ts`'s `cell` (live entity storage for the HA layer, the one remaining
`@vue/reactivity` use). The pre-consolidation legacy core (`value.ts` Kleene helpers, `types.ts`,
`graph.ts` and their tests) has been **removed**.

**Verified** (`pixi run check` — 95 tests): canonical example end-to-end; re-derivation with no
transition modeling; **offline sensor does not actuate** (Kleene `unavailable` propagates);
determined-false still turns off; translate→core path removed; live WS deploy round-trip;
**default-only light actuation** (sink works from inline defaults, no wiring); stateful nodes
(edge/hold/fold) seed-at-boot and never fire/corrupt on non-`Ok`; time/duration derivations
(`since`/`duration`) with injected clock; variadic AND/OR/SUM fold + serialized-arity round-trip;
async `fetch` source loading/error/value through `Value<T>`; the new sinks (call/climate/cover/
input/notify/TTS) reconcile or edge-fire and never actuate on non-`Ok`.

### Editor frontend (built; in-browser, step 1)
Implemented in `frontend/` from the Claude Design handoff (`.design-bundle/`): Vite + React +
TypeScript. **Styling is proper Tailwind v4** (D21): the design's OKLCH tokens are registered
in `@theme` referencing the runtime `--rw-*` vars (so utilities like `bg-rw-node` follow the
active aesthetic), and components use utility classes — arbitrary values only for the dynamic
per-type `color-mix` tints. Three aesthetics (IDE / Blueprint / Warm) × light/dark.

- **Components** (`src/components/`, each with a Storybook story): `ValueChip`, `Pin`,
  `HealthDot`, `MemBadge`, `ColorWidget`, `SinkPanel`, `NodeView`.
- **Editor app** (`pixi run fe-dev` → localhost:5173) on **React Flow** (D5): the node visuals
  are an RF custom node (`canvas/RWNode.tsx`) with a `Handle` per typed pin; live values come
  from an in-browser reactive engine (`src/engine/evaluate.ts`) via a results context. Wires
  are type-colored and animated. **Editing works**: drag pins to **connect** (with type +
  cycle validation, `canvas/validation.ts`), **select**, **delete**, and drag — pan/zoom from
  React Flow. The old custom canvas (`canvas/Canvas.tsx`, `Wire.tsx`) is superseded.
- Verified: `pixi run fe-typecheck`, `pixi run build-storybook`, `pixi run fe-build`.

### Engine consolidation (done)
There is now **one engine**: the pure `evaluate` (`frontend/src/engine/evaluate.ts`), used by
the editor for preview *and* by the server for actuation (`src/server/runtime.ts` imports it).
`evaluate` was made **Kleene-correct** (determined `false AND unavailable = false`), matching
the old core engine's safety semantics. The signals core `Engine`, node catalog, `translate`
adapter, and their tests were **removed**; the editor↔server graph is now the same shape end
to end (no translation), and every editor node type (incl. `toggle`/`sum`/`select`) deploys.
Verified: 124 tests (incl. canonical + Kleene + safety on `evaluate`), both typechecks, and a
live WS deploy round-trip. _Minor remaining tidy-up:_ the HA adapters keep an unused reactive
`entity()` getter and `value.ts` keeps now-unused Kleene helpers (still unit-tested).

### Editor ↔ server (step 2, built)
The headless server streams a **live entity feed** over WebSocket (`src/server/feed.ts`,
default `ws://localhost:7420`): full snapshot on connect, coalesced broadcasts on change.
Works against **real Home Assistant** (verified — streamed hundreds of live entities) or a
built-in **simulator** (`src/server/sim.ts`) when no `HA_URL`/`HA_TOKEN`. The editor connects
via `useServer`, and shows **LIVE** (real HA) vs **DEMO** (offline sim). **Safety:** running
the server and the editor's preview never changes the home — the auto-started demo graph is
dry-run; sinks actuate only when the editor deploys (also backed by the non-`Ok`→don't-actuate
rule, D18).

### Editing (built)
- **Entity nodes are generic** (`type: "entity"`, `config.entity_id`) and read the live entity
  map — point a node at any of your HA entities. `evaluate` takes an entity map; the offline
  sim and the server feed both supply it.
- **Inspector** (`canvas/Inspector.tsx`): selecting a node shows its live output values, pin
  types, and config editors (entity id, compare op/threshold, constants); edits update the
  preview live.
- **Deploy**: the editor sends its graph over WS; the server runs it with the same engine
  (`evaluate`) and actuates. An explicit **Deploy** or **auto-deploy** runs it **live**;
  editing returns to a draft (sinks dry-run) until the next deploy. Verified: a live WS
  round-trip (deploy → `deployResult ok`).

### Editing — palette & config (built)
- **Palette** (`canvas/Palette.tsx`): searchable, category-grouped node list. **Drag** a node
  onto the canvas (drops at the cursor via `screenToFlowPosition`); click also adds.
- **Entity autocomplete** (`canvas/EntityPicker.tsx`): reusable input + dropdown over the live
  entity ids, **domain-filterable** (e.g. a light sink only offers `light.*`). Used in the
  inspector and the on-drop popup.
- **On-drop config popup** (`canvas/NodeConfigPopup.tsx`): templates declare `requires`
  (e.g. `{field:'entity_id', kind:'entity', domains:['light']}`); dropping such a node opens a
  popup to set it immediately. Switches on `kind`, so new config kinds plug in with one case.
- Background dots/zoom and node shadows tuned toward the design tokens.

### Editable pin values (one mechanism)
A pin may carry an editable literal value (`PinDef.editable`), stored per-node in
`NodeData.values[pinId]`. One mechanism, three uses:
- **Input default** — used by the engine when the pin is unconnected (`inEff`).
- **Constant** — a const node is just a node with one editable *output* pin; its output is
  the typed literal.
- **Compare operands** — compare has two generic pins `a`/`b` (a `typeGroup`); the unconnected
  one resolves to the connected one's type and uses its editable default. Operator set narrows
  by resolved type (`< > <= >=` numbers only; `== !=` everywhere; lexicographic for strings).
Editors: one `PinValueEditor` per type (number/bool/string/color), shown inline on the node
*and* in the inspector (`NodeValueEditors`) — editable outputs always, editable inputs only
while unconnected (`EvalResults.connected` drives that). Light sink `color`/`brightness` are
editable inputs (set a fixed value without wiring a constant).

## 9. Roadmap / TODO

### Recommended next
1. **Persistence (Q9).** Editor **save/load** of graphs; server **persists the deployed graph
   to disk** and **reloads + re-runs it on restart**. Turns a live demo into a real always-on
   tool (currently a restart loses everything). The deploy payload is already the save format.

### Core engine / model

**Built** (single shared `evaluate`; verified by `pixi run check`, 124 tests):
- ✅ **Stateful nodes**: `edge`/`rising`/`falling`, `hold(initial)`, `fold`/`scan` (joining
  `toggle`). Each declares a **state-persistence policy** (Q3a): `seed-at-boot` (default,
  ephemeral, restart-safe), `durable` (kept verbatim when a restored memory map is passed
  back — for the persistence layer to save/restore), `reseed-from-world` (boots initial state
  from a configured entity's live value). On-disk persistence itself is still Q9 below, so
  `durable` behaves like `seed-at-boot` until that lands.
- ✅ **Time / duration nodes**: `now()` + `since`/`duration` (ms/sec/min/hr). Time is an
  explicit injected `now` (epoch ms) param — the server drives a 1s tick, the editor ticks
  React state, tests pass fixed values. Entities expose `last_changed`/`last_updated` as
  epoch-ms numbers, so "open for 10 min" = `since(door.last_changed) > duration(10,min)`.
- ✅ **Variadic auto-grow pins** (D14): `AND`/`OR`/`SUM` always show one trailing empty pin;
  connecting it fills it and spawns the next, with stable pin ids that survive serialization.
  (No shrink-on-disconnect yet — a stale empty pin is harmless; the fold ignores it.)
- ✅ **Async / data-source nodes**: a `fetch` node whose value flows through `Value<T>`
  (Unavailable while loading, `Error` on failure, `Ok` with parsed value). Fetching lives at
  the edge in a server-side `Poller`; the engine stays synchronous and only reads the last
  result. Output type isn't yet reconfigurable in the UI (numeric default).
- ✅ **More sinks**: generic `callService`; reconciling `climate`/`cover`/`input_*` (diff
  desired vs actual, echo-safe); `notify`/`TTS` as edge-triggered transients (fire on change,
  seed-at-boot restart-safe). The non-`Ok`→don't-actuate safety rule is enforced centrally.

_Minor follow-ups from review:_ `fold`/`scan` are currently semantic twins (continuous wires
collapse the reduce-vs-scan distinction); `fetch` output-type selector; variadic
shrink-on-disconnect; a persistence-policy selector in the editor (policy is set via template
config defaults for now).

### Editor UX (built)
- ✅ **Chrome** (D15/D20): Problems panel (structural vs runtime, click-to-focus), HA-disconnected
  banner with stale/greyed values, connect-rejection toasts that explain themselves, deploy guard
  (block hard / warn soft), tri-state draft/live/disconnected pill.
- ✅ **Macros / subgraphs** (D16): group-into-node, definition canvas with typed I/O boundary
  nodes, palette section, independent-state instances (inlined/expanded into the one engine),
  export/import JSON with nested deps + forking (D7/D8).
- ✅ **Comments** (Unreal-style boxes, annotation-only) and **mobile** layout (drawer palette,
  bottom-sheet inspector, mobile nav). Plus an undo/redo stack.
- ✅ Multiple flows / organization (tabs, per-flow memory); inspector **sparkline** of value
  history (D6).
- ✅ **Node descriptions**: one-line per-node description in the registry, shown in the inspector
  and as a palette hover tooltip.

_Minor follow-ups from review:_ comments/multi-flow are send-only until graph save/load (Q9)
exists; `fetch` output-type selector; variadic shrink-on-disconnect.

### Architecture / tidy-up (built)
- ✅ **Per-node registry**: each node type is a self-contained `NodeDef` under
  `shared/engine/nodes/`; `evaluate` dispatches over it (cross-cutting machinery stays shared).
- ✅ **Shared engine package**: engine + `value`/`results`/`node-types`/`entities`/`theme`/`macros`
  moved to a neutral `shared/` dir both the editor and server import; the `server → frontend/src`
  dependency is severed.
- ✅ **Removed legacy root `src/` dead code**: `ha/` `entity()` getter, the legacy `value.ts`
  Kleene helpers, and `graph.ts`/`types.ts` (plus their now-obsolete tests). `@vue/reactivity`
  remains only behind the HA layer's `cell` (live entity storage).
- (Optional) Stream server-*computed* pin values so the editor is a pure view (D6/D9 refinement)
  — would let the editor drop its in-browser engine.

### Productionization (later)
- **Ship as a Home Assistant add-on** (Supervisor Docker, ingress UI, `SUPERVISOR_TOKEN`) — Q10.
- **Conda-package node distribution** (D8) + a community index.
- Multi-user / auth beyond a long-lived token (currently a non-goal).
- Error-UX completeness (D19 schema-drift ghost-pin healing; full D20).
