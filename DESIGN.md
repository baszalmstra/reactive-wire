# Reactive Wire — Design Document

> A node-based **reactive** automation system for Home Assistant: a typed, inspectable
> graph where an entity's state is *derived* from the combined state of other entities
> and data sources, rather than imperatively scripted through transitions.

**Status:** Living document — design grilling complete; now tracking implementation.
**Last updated:** 2026-07-06

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
- Full multi-user auth (roles/users/OAuth). The server *does* ship a deliberate exposure model —
  loopback-default bind, a deploy token, and host/origin allowlists (**D23**) — but not identity
  or per-user permissions.
- Full parity with Node-RED's node catalog.

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
| D21 | Editor styling | **Tailwind CSS v4 + small repository-owned accessible primitives** (native modal dialog wrapper, ARIA tabs, checkbox, tooltip, focus/live-region conventions). Dark-mode-first; pairs cleanly with custom React Flow nodes without a Radix/shadcn runtime dependency. | Full control of the node-canvas look while centralizing keyboard, focus, motion, and announcement behavior in tested primitives. |
| D9 | Runtime topology | **Headless server is the source of truth** (option b, built immediately — not staged). The **server** owns the HA WebSocket connection, runs the flows 24/7, and calls services. The **editor is a live view** that loads/saves graph JSON and subscribes to the server's node/wire values. Reactive **engine is one shared TS module** imported by the server (and reused by the editor for type-checking/preview). | Always-on automation is the actual goal; canvas = view over runtime state. |
| D10 | Reactive engine | **Signals core** (recommended **alien-signals**, fallback `@vue/reactivity`) for glitch-free, topologically-ordered, lazy propagation. RxJS only at async edges, never the core. | Signals are the only family giving glitch-free diamond propagation for free (§5.2). |
| D11 | **Behaviors-only wires + stateful nodes** | The graph has **one wire type: behaviors** (continuous, always-current values). No separate "event" wire type. The event-ish residue (edge/`rising`, `scan`/`fold`/toggle, dedup, `hold`) collapses into **nodes with local state** — analogous to React: pure node = `useMemo`, stateful node = `useState`/`useReducer`/`usePrevious`. Implemented as a writable signal updated by an effect over inputs. Editor marks stateful nodes with a "has memory" badge so the graph stays honest. | Maximally reactive & one honest wire type; pushes durations/timers (time is a behavior) and reconcilable actions into pure derivation; confines memory to where it's irreducible. Driven by user's "it's local state, like useState" insight. |

| D12 | Type system | **Primitives only: `boolean`, `number`, `string`** — plus a **`Color`** type (light color is central). **No enums** for now (strings cover HVAC modes, light effects, etc.). Nominal semantic types (Brightness/Kelvin) and HA-domain entity types are **rejected** for the prototype. Connection rule: exact-type match or explicit conversion node (no silent coercion). Wires colored by type. _(Extended — see §3.1: `duration`/`datetime` added as first-class types; entity pins typed from `device_class`.)_ | User wants minimal; primitives are enough to start; Color earns its own type because it's the headline use case. |
| D13 | Entity nodes | **Each HA entity is a node; each attribute (and its state) is exposed as its own typed output pin.** The node introspects the entity and emits one pin per attribute. Pin types via best-effort parse at the boundary: numeric→`number`, on/off/home/etc.→`boolean`, color attrs→`Color`, else `string`. (This *is* the "parse HA's stringly-typed states into typed behaviors" layer.) | Node-RED-like clarity but typed; no need to pre-model HA domains as types — the node self-describes from the live entity. |

| D14 | Variadic & generic pins | **Variadic (n-ary) inputs** for associative/commutative reducers (`AND`, `OR`, later `SUM`/`MIN`/`MAX`/`CONCAT`) via **auto-growing pins** (always one trailing empty input; connecting it spawns the next). Kept **homogeneous** (all inputs same type). **Genericity only as connect-time pin resolution**: "open"/`any` pins lock to a concrete type on first connection (covers generic `Select`/`if`, passthrough, `hold`). **Full macro-level type parameters stay deferred** (refines D12). | Directly attacks the core pain (combining many conditions cleanly); cheap to implement (engine folds over connected inputs); avoids a real generic type system while still typing `Select`. |

| D15 | Edit/deploy model | **Hybrid, user's choice.** Live **preview always on** while editing (values flow through the draft; sinks run **dry-run** = show what they *would* write). An **auto-deploy checkbox**: when on, edits apply to the live actuating engine immediately; when off, changes go live only on an explicit **Deploy**. Auto-deploy is durable authorization and a valid enabled graph resumes live after server restart; manual mode starts undeployed. Already-deployed graph keeps running untouched until (auto-)deploy. Default: manual deploy (safe). | Satisfies live-value inspection (D6) and always-on safety (D9) simultaneously; lets power users opt into live-edit immediacy while making restart policy explicit. |

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

- **D10 (reactive engine) — superseded.** We did **not** ship a signals core. The shared
  transactional evaluator is **Kleene-correct** for 3-valued logic and remains the reference
  semantics used by the editor. A deployed graph is expanded, detached, frozen, and compiled once;
  the server retains results and evaluates only the ordered downstream dirty closure for entity,
  fetch, clock, and retry causes. Differential tests keep that incremental path equivalent to full
  `evaluate`. This preserves one semantic engine without rebuilding graph indexes on every event.
  `@vue/reactivity` has been dropped from the runtime entirely. See §8.
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
- **D12 (type system) — extended.** The wire types are no longer just the primitives + `Color`.
  Two temporal types are now first-class (`shared/runtime-types.ts` `ValueType`, `shared/value.ts`):
  **`duration`** (a span carried internally as seconds) and **`datetime`** (an instant carried
  internally as epoch-ms). They have their own wire color, chip formatting, and parsing, and back
  the time nodes below. Entity **state** pin typing is now **device-class-driven**, not a
  best-effort parse of the current value (`entityStateType`, `shared/value.ts`): a
  `binary_sensor` is `bool`; a sensor whose `device_class` is `timestamp` → `datetime`,
  `duration` → `duration`, `enum` → `str`, and any other declared class or a
  `unit_of_measurement` → `num`; only a class-less, unit-less entity falls back to sniffing the
  raw state (hex→`Color`, on/off words→`bool`, finite→`num`, else `str`). Typing from metadata
  keeps a pin's type stable even while the entity is `unavailable`. `last_changed`/`last_updated`
  are exposed as **`datetime`** pins (not raw epoch-ms numbers). New nodes: `datetimeSubtract`
  (two `datetime` → the `duration` between them) and `datetimeShift` (a `datetime` ± a `duration`
  → a shifted `datetime`), alongside `now`/`since`/`duration`. Device classes also drive editor
  affordances (`frontend/src/components/DeviceClassIcon.tsx`). Enums remain unmodeled — HA `enum`
  device classes still surface as `str`, so the original "no enums" call stands.

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
- ✅ **Q9 Persistence / format**: collaborative editor document persistence and reload-on-restart
  are built via Yjs updates. Persisted `autoDeploy=true` reconstructs and validates the configured
  graph on boot, then resumes it live; manual deployments are intentionally not restored. Durable
  stateful-node memory is stored separately (see §9).
- ✅ **Q10 Execution location & lifecycle**: when does the graph run? Headless vs needs editor open?
  - ✅ Topology = D9 (headless server is source of truth).
  - ✅ **Home Assistant add-on shipped**: Supervisor-managed multi-architecture image,
    ingress-proxied editor, `/data` persistence, and Supervisor API authentication via
    `SUPERVISOR_TOKEN`. The standalone server remains supported for development and other installs.
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
- Build one canonical current-state map from **`getStates`**, then apply raw
  **`state_changed` events in O(1)**. Initial connection and reconnect install a versioned full
  snapshot; ordinary changes publish ordered versioned deltas. This seeds every behavior from t=0
  without rescanning, cloning, or retransmitting all H entities for each event. Connection state is
  an explicit `disconnected → syncing → ready` epoch: the runtime pauses evaluation/effects on loss
  and cannot actuate again until that epoch's fresh full snapshot has been installed and reconciled.
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
**Tailwind v4 + repository-owned accessible UI primitives** (D21).

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

The same drift principle now covers **node-template drift** and is **built** as read-side def
reconciliation (`shared/engine/reconcile-defs.ts`, see §8): a persisted node def is healed against
the current code templates when the document is read — pins the template gained appear, pins it
dropped become ghosts (kept while wired, dropped when unwired), entity nodes and unknown types are
left to their own logic. This is the auto-heal that was previously roadmap.
| D20 | Error UX | Inline red/dashed error pins + tooltips; value chips show `unavailable`/`error` **distinctly** (never blank/fake). **Node health badge** (ok/warn/error) legible zoomed-out. **"Problems" panel** (structural vs runtime, click-to-focus). Connect-time rejections **explain themselves**. **Deploy guard**: block hard errors, warn soft. **HA-disconnected banner** + stale/greyed values + **no actuation while disconnected**. | "User interaction around errors" is first-class, not an afterthought. |
| D23 | Server security model | **Safe-by-default exposure, opt-in to expose.** The deploy/control WebSocket **binds to loopback** (`127.0.0.1`) by default; binding outside loopback **requires `RW_DEPLOY_TOKEN`** (refused otherwise). Host and Origin are checked against allowlists (`RW_ALLOWED_HOSTS`/`RW_ALLOWED_ORIGINS`), with loopback hosts/origins and local-file (`Origin: null`) connections allowed only from loopback. The loopback test is **DNS-rebind-resistant** (only numeric `127.x` / `::1` / `localhost` qualify — `127.attacker.example` does not), and the token check is **timing-safe** (`timingSafeEqual`). Every deploy graph and every collaborative-document update is **structurally sanitized** before use (`sanitizeDeployRequest`, `shared/collab.ts`): node/edge/macro/pin count caps, bounded string length and JSON depth, prototype-pollution-safe keys, and coercion to the known wire types. | A home-automation server actuates real devices, so exposure must be a deliberate act, not a default. Loopback + token + allowlists resist LAN/CSRF/DNS-rebind reach; input caps bound the blast radius of a malicious or buggy client without a full auth system (still a non-goal — see §2, §9). |

Implementation: `src/server/connection-policy.ts` (bind/host/origin/token) and
`src/server/deploy-validation.ts` (graph sanitization); the same caps apply to collab updates in
`shared/collab.ts`. Configured via `RW_HOST`, `RW_DEPLOY_TOKEN`, `RW_ALLOWED_HOSTS`,
`RW_ALLOWED_ORIGINS` (documented in `.env.example`).

## 8. Architecture (current, as built)

Single TypeScript codebase, pixi-managed. **One engine** powers both editor preview and
server actuation. This section is the **only** current-state map; older chronological build-log
prose has been folded in and removed. The tree is four layers: a DOM-free **`shared/`** engine
and wire model, an always-on **`src/server/`**, a React **`frontend/`** editor, and a thin
**`src/ha/`** Home Assistant adapter.

**Shared engine — `shared/`** (single source of truth for semantics, imported by **both** the
editor and the server; the server never reaches into `frontend/`): a neutral, DOM-free directory
both tsconfigs include. `shared/engine/evaluate.ts` defines the transactional reference evaluator
and retained incremental evaluator over resolved `RWValue` pins, health, sink actions, and memory.
`shared/engine/compile.ts` expands and freezes a deployment once and builds incoming, downstream,
entity/fetch/clock, sink-order, and durable-node indexes. Each dirty node runs once and proposes all
outputs plus replacement memory; proposals commit together only after the transaction succeeds.
Kleene 3-valued logic (D18); editable pin
defaults via `inEff` (D22); generic-type resolution via `typeGroup`; strict-DAG cycle guard
(D17). `sinkCalls()` turns sink inputs into concrete HA service calls (non-`Ok` → skipped — the
safety rule). Supporting modules: `engine/expand.ts` (macro inlining), `engine/node-def.ts`
(the `NodeDef` contract), `engine/engine-support.ts` and `engine/ha-reconcile.ts` (shared
reconcile/diff helpers), plus `value.ts`, `results.ts`, `node-types.ts`, `entities.ts`,
`theme.ts`, `macros.ts`, and `collab.ts` (the collaborative-document model — see below).
Runtime semantics are deliberately separate from editor presentation: `runtime-types.ts` defines
`RuntimeNode`, typed pin/value payloads, and known config contracts; `node-types.ts` composes those
semantics with `NodeViewState` for the persisted canvas. Deployment sanitization discards geometry,
icons, and widgets before the graph reaches the evaluator. `theme.ts` only re-exports the domain
`ValueType` for source compatibility.

**Node registry — `shared/engine/nodes/`**: each node type is a self-contained `NodeDef` (plain
object, not a class) — its palette template, one-line description, atomic `eval(ctx)` returning
all declared outputs and optional next memory, and (for sinks) an atomic `evalSink` proposal.
`index.ts` assembles the registry; `evaluate.ts` keeps the cross-cutting machinery (Kleene helpers,
generic/variadic resolution, transactional memory threading) and dispatches to it.
`frontend/src/canvas/node-templates.ts` re-exports the registry-derived `PALETTE`/`describeNode`
plus editor-side variadic-pin helpers, so a node's presentation and behavior live in one place.
Built-in nodes: `entity`, `const`, `compare`, `logic`, `sum`, `select`, `passthrough`, the
stateful `edge`/`hold`/`fold`/`toggle`, the async `fetch`, the time nodes (`now`/`since`/
`duration`/`datetimeSubtract`/`datetimeShift`, see `time.ts`), the macro `boundary` nodes, and
the sinks `sink-light`/`sink-call`/`sink-climate`/`sink-cover`/`sink-input`/`sink-transient`.

**Server — `src/server/`** (always-on source of truth, D9):
- `index.ts` — boots `RealHA` (`HA_URL`/`HA_TOKEN`) or `MockHA` + `sim.ts`; reads config from
  env (`RW_PORT`, `RW_HOST`, `RW_DEPLOY_TOKEN`, `RW_ALLOWED_HOSTS`/`RW_ALLOWED_ORIGINS`,
  `RW_DATA_DIR`); starts the feed; holds the `Deployer`, the `EditorDocumentStore`, and the
  `AutoDeployController`.
- `feed.ts` — WebSocket (default `:7420`): sends a versioned entity snapshot on connect and
  ordered compact deltas after a client explicitly negotiates `delta-v1`, accepts `deploy`
  requests, and carries the collaborative-document frames. Unknown/older editor clients continue
  receiving full snapshots on every entity change, so an already-open tab does not freeze during a
  server upgrade. New editors also accept unversioned legacy snapshots; without the newer
  `haStatus` frame they conservatively show HA as syncing rather than claiming live readiness.
  Every upgrade passes the connection-policy check first.
- `runtime.ts` — `Deployer`: compiles macro-expanded graphs once, retains results, and schedules
  ordered dirty-closure transactions from entity deltas, fetch completions, observed clock roots,
  and sink retries. Graphs without clock-dependent nodes have no clock timer. Debug state exposes
  transaction cause and evaluated-node counts. Each sink owns a serialized delivery channel:
  reconciling/command work coalesces to the latest desired call, while transient work uses a
  bounded FIFO with visible overflow state. Physical lanes survive redeployment, so a replacement
  call for the same sink waits for an already accepted HA call; an unchanged transient sink keeps
  its accepted FIFO, while removing/changing a sink discards queued work but lets its active call
  settle. Thus Home Assistant never receives overlapping calls from one sink. Delivery tracks
  observed, enqueued, attempted, and acknowledged states separately;
  failures retry on a capped exponential timer with stable per-sink jitter rather than incidental
  graph ticks; a shared executor bounds aggregate Home Assistant concurrency. Retry identity includes
  only world fields read by the reconciler, so unrelated target metadata cannot cancel backoff.
  Retries pause while HA is not ready, reconciling work is revalidated before replay, and transient work remains
  queued until acknowledgement (at-least-once within a running process). Preview remains dry-run
  and the non-`Ok` safety gate remains in the engine. Delivery queues are currently memory-only:
  a process crash after HA accepts a transient call but before its acknowledgement is observed has
  an unavoidable ambiguous duplicate/loss window until a durable idempotency protocol is added.
  `stop()` is a terminal, idempotent lifecycle
  boundary: it unsubscribes sources, invalidates async generations, clears live state, and rejects
  later deployments. A service call already accepted by Home Assistant cannot be recalled, but its
  completion cannot mutate the stopped runtime.
- `poller.ts` — the async data-source driver: for each `fetch` node it polls the URL on the
  node's interval, decodes the body, and writes the latest `SourceResult` (loading→`unavailable`,
  failure→`error`, success→`ok`) into a source map the synchronous engine reads. Each source is
  single-flight and schedules its next request only after completion; requests time out, failures
  back off to a cap, and stop/redeploy aborts active work and invalidates late completions.
- `doc-store.ts` — `EditorDocumentStore`: the server-side Yjs `Y.Doc`, persisted as a binary
  snapshot under `RW_DATA_DIR` (`editor-doc.ydoc`, atomic tmp+rename write) and reloaded on
  boot — the editor document survives restarts. On load it checks the persisted schema version: a
  current-version document loads as-is, an older one is migrated (see the migration path below), and
  a newer one is refused with a clear error (downgrade protection).
- `collab-deploy-adapter.ts` — projects all server-enabled flows from the collaborative document
  into one namespaced deploy graph (`graphFromEditorSnapshot`) and the `AutoDeployController` that
  redeploys when `autoDeploy` is on and the combined graph signature changes.
- `connection-policy.ts` / `deploy-validation.ts` — the security layer (D23): host/origin
  allowlists, loopback-default bind, timing-safe deploy-token check, and structural
  sanitization of deploy graphs. See "Server security model" below.
- `sim.ts` — the offline entity simulator used when no `HA_URL`/`HA_TOKEN` is set.

**Collaborative document & persistence** (`shared/collab.ts`, `src/server/doc-store.ts`,
`frontend/src/state/editor-document.ts`): the editor document — flows (nodes/edges), macros, and
server-owned `settings` (`autoDeploy`, `deployedFlowIds`, plus legacy `deployFlowId` compatibility) — is a **Yjs CRDT** (`shared/collab.ts`
defines the `Y.Doc` shape, snapshot/diff projection, and sanitization caps). Clients and server
exchange it as base64-encoded Yjs update frames (`docState`/`docUpdate`/`docError`) multiplexed
over the **existing feed WebSocket** rather than a dedicated binary endpoint (see the collab
rationale in §9). `autoDeploy`/`deployedFlowIds` are **server-owned document settings**, so the
server can auto-deploy all enabled flows independently of any client's active tab. Deploy remains
an explicit act: a remote collaborator's edit only actuates Home Assistant when `autoDeploy` is
enabled. That enabled setting is durable authorization, so the valid combined graph of enabled
flows also resumes live during server startup (see the safety caveat in §9). Accepted updates are validated against a
retained shadow `Y.Doc`, then compacted into short asynchronous persistence batches; feed broadcast
and auto-deploy occur only after the containing batch is durable. Frontend snapshot projection
structurally shares unchanged flows, nodes, and edges.

**Document migration** (`shared/collab-migrations.ts`): the document meta carries a schema
version. A registry of pure snapshot-level migrations, keyed by the version each step upgrades from,
lifts an older persisted snapshot stepwise up to the current version. The only registered step is
the legacy normalization from version 0 — a document written before the schema carried a version
reads back as version 0 and its content already matches version 1, so the step is a structural
re-stamp; no schema-changing migration exists yet because the version is still 1. When the server
loads a document older than current, it reads the snapshot leniently (bypassing the version guard
the strict reader enforces for current-version docs), migrates the JSON snapshot, backs up the
original file (`editor-doc.ydoc.v<old>.bak`, never overwriting an existing backup), rebuilds a fresh
`Y.Doc` from the migrated snapshot, and persists it. Rebuilding drops the old CRDT edit history,
which is acceptable for this single-server store since clients resync from scratch. A version newer
than the build supports is refused outright.

**Read-side def reconciliation** (`shared/engine/reconcile-defs.ts`): node defs are persisted in
full inside the document, so a stored def can carry pin shapes that predate a change to the node's
code template. `reconcileDefs` heals a stored def against the current templates as the document is
read: pins the template gained appear at their template position (with template defaults, preserving
stored editable values), pins the template dropped are marked as ghosts so their wires survive —
kept while wired, dropped when unwired — and unknown node types are left untouched. Entity nodes
keep their own live-attribute ghost logic and are skipped; a variadic node's grown pins are
preserved rather than ghosted. Reconciliation runs on the **read** side only — where the client
projects the collaborative document into editor state (`frontend/src/state/editor-document.ts`) and
where the server projects a snapshot to a deploy graph before validation
(`collab-deploy-adapter.ts`). On the client the local-edit diff baseline is set to the **reconciled**
projection that was rendered into editor state, not the raw document snapshot, so a healed def is
not mistaken for a local edit: opening a drifted document neither rewrites it nor broadcasts a
CRDT update, and concurrent clients do not ping-pong healing deltas. A user edit that actually
touches a node naturally persists its reconciled shape.

**Server security model** (D23): the deploy/control socket **binds to loopback by default**;
binding outside loopback without an `RW_DEPLOY_TOKEN` is refused. `connection-policy.ts` enforces
Host and Origin allowlists (`RW_ALLOWED_HOSTS`/`RW_ALLOWED_ORIGINS`, loopback allowed by
default), a **DNS-rebind-resistant** loopback check (only numeric `127.x` / `::1` / `localhost`
count as loopback, so `127.attacker.example` does not), and a **timing-safe** token comparison.
`deploy-validation.ts` (`sanitizeDeployRequest`) structurally validates every deploy graph:
node/edge/macro/pin count caps, prototype-pollution-safe keys, bounded string/JSON depth, and
type coercion to the known wire types. `collab.ts` applies the same class of caps to incoming
document updates.

**Editor — `frontend/src/`**: React + Vite + Tailwind v4 + React Flow (D5). Styling is proper
Tailwind v4 (D21): the design's OKLCH tokens are registered in `@theme` referencing runtime
`--rw-*` vars, across three aesthetics (IDE / Blueprint / Warm) × light/dark.
- `App.tsx` — wires the entity feed (or offline sim) → `evaluate` → React Flow; drives deploy/
  auto-deploy, theme, connection state, and the collaborative-document sync.
- `server-conn.ts` — the `useServer` hook: entity feed, deploy round-trip, and the
  `docState`/`docUpdate` collaboration transport; surfaces **LIVE** (real HA) vs **DEMO** (sim).
- `state/editor-document.ts` — the client projection between React Flow working state and the
  collaborative document snapshot.
- `canvas/` — `RWNode` (custom node + typed Handles), `validation` (type + cycle), `Palette`,
  `Inspector`, `EntityPicker`, `NodeConfigPopup`, `NodeValueEditors`, `results-context`, the
  macro editor (`MacroEditor`, `MacroList`, `MacroBoundaryPanel`, `use-macros`, `macro-io`),
  `flows` (per-flow tabs), `comments`, `grouping`, `problems`, and `use-value-history`
  (inspector sparkline).
- `components/` — `ValueChip`, `Pin`, `Badges`, `Widgets` (`PinValueEditor`/`OpSelect`/
  `SinkPanel`), `Banner`, `Toast`, `ProblemsPanel`, `DeployGuard`, `StatusPill`, `FlowTabs`,
  `MobileBar`, `Sparkline`, `DeviceClassIcon`, `Icon`, and `NodeView` (Storybook only).

**Home Assistant adapter — `src/ha/`**: `client.ts` (`HAClient` + `EntityFeed` interfaces),
`mock.ts` (`MockHA`), `real.ts` (`RealHA` — `subscribeEntities` + `callService`).

**Editable pin values (D22)**: a pin may carry an editable literal (`PinDef.editable`, stored in
`NodeData.values[pinId]`). One mechanism, three uses — an **input default** used by the engine
when unconnected (`inEff`), a **constant's** output literal, and **compare's** operands (two
generic `typeGroup` pins; the operator set narrows by resolved type). Editors: one
`PinValueEditor` per type shown inline on the node and in the inspector; editable outputs always,
editable inputs only while unconnected (`EvalResults.connected` drives that).

**Observability & operations**: a `debugState` introspection
message on the feed WebSocket exposes the deployed graph and current pin values for tooling; a
structured stdout logger (level via `RW_LOG_LEVEL`) replaces ad-hoc `console` calls; durable
runtime **memory persistence** for the `Deployer` writes stateful-node memory slots to
`RW_DATA_DIR` so `durable`-policy state (Q3a) survives restarts alongside the editor document.

**Build & CI**: pixi drives tasks; Vitest is split into an
**engine** project (node) and a **frontend** project (jsdom); **GitHub Actions** runs typecheck +
unit + e2e (Playwright) via pixi. The dead pre-React-Flow renderer (`Canvas`/`Wire`/`NodeView`
canvas path) and the vestigial `@vue/reactivity` layer (`src/reactive.ts`, `src/value.ts`) are
removed; `App.tsx` is decomposed into hooks under `frontend/src/state/`; fonts are self-hosted
(`@fontsource`).

**Verified** (`pixi run check`): canonical example end-to-end; re-derivation with no transition
modeling; **offline sensor does not actuate** (Kleene `unavailable` propagates); determined-false
still turns off; live WS deploy round-trip; **default-only light actuation** (sink works from
inline defaults, no wiring); stateful nodes (edge/hold/fold) seed-at-boot and never fire/corrupt
on non-`Ok`; time/duration derivations (`since`/`duration`, datetime shift/subtract) with an
injected clock; variadic AND/OR/SUM fold + serialized-arity round-trip; async `fetch` source
loading/error/value through `Value<T>`; the sinks (call/climate/cover/input/notify/TTS) reconcile
or edge-fire and never actuate on non-`Ok`; collaborative-document round-trips, sanitization caps,
and connection-policy host/origin/token rejection.

## 9. Roadmap / TODO

### Recommended next
1. **Operational hardening for collaboration.** The editor document now persists and live-syncs;
   next persistence work is operational polish: backups/restore UI, optional multi-document routing,
   presence indicators, and server-computed pin-value streaming so the editor can become a pure view.

### Collaboration & persistence — rationale and known gaps

**Why Yjs.** Collaborative, restart-surviving editing was researched against Automerge, ShareDB/OT,
and a hand-rolled op protocol. Yjs won on adoption/maintenance, a mature browser+server CRDT with
conflict-free merge and awareness/presence, and a persistence model built on binary document
updates that replay after a restart. Automerge's repo/network stack was smaller and moving fast;
ShareDB adds server-authoritative OT transform complexity and weaker offline behavior; a custom
protocol pushes every hard case (concurrent delete/edit, dangling edges, duplicate ids, reconnect
gaps) onto us. The graph is modeled as a CRDT document (maps keyed by stable id), not a stream of
UI commands.

**Why the shipped transport diverged.** The research recommended a **dedicated collaboration
endpoint** carrying **binary** Yjs sync frames (`y-websocket`/Hocuspocus or a `y-protocols/sync`
adapter). The build instead multiplexes **base64-encoded Yjs updates as JSON `docState`/`docUpdate`
frames over the existing feed WebSocket** — the minimal-change path that reuses the one socket and
its host/origin/token policy (D23), at the cost of base64 overhead and a homegrown handshake. If
this transport is revisited, the migration is: add binary frames, then a state-vector handshake,
then move persistence to binary — do **not** persist the document as JSON.

**Persistence approach.** The server holds the authoritative `Y.Doc` and persists a compacted
binary snapshot (`Y.encodeStateAsUpdate`) to `RW_DATA_DIR` after a short batch of accepted updates
(atomic async tmp+rename), reloading it on boot. Each sender's update promise resolves only after
that batch is durable; shutdown flushes pending work. Startup applies an explicit deployment policy: manual documents
remain undeployed, while persisted `autoDeploy=true` is treated as durable authorization and resumes
a valid configured graph live. An invalid enabled graph is logged and remains undeployed. This is
the "custom store around the Yjs update APIs" option from the research rather than `y-leveldb`
(deprecated) or a scale-out backend (`y-redis`/YHub, deferred until multi-instance is needed).

**Known gaps carried forward** (recurring across review rounds; not yet fixed):
- **Remote-edit → auto-deploy actuation.** With `autoDeploy` on, a **remote** collaborator's edit
  can drive a live Home Assistant actuation through another client. Needs a security regression
  test asserting remote updates alone never call `deploy()` (only local edits do), and likely a
  deliberate policy for who may trigger server actuation.
- **Concurrent array clobbering.** The snapshot-diff sync recurses into plain objects but treats
  arrays (macro `nodes`/`edges`, pin lists) as last-writer-wins scalars, so concurrent edits to
  different elements of the same array lose one side. Wanted: id-keyed maps for nested collections.
- **Update/schema validation before persist.** *Version drift is now handled:* `applyUpdate`
  projects the candidate document and rejects an unsupported `meta.version` before persisting, and
  the load path migrates an older version and refuses a newer one (see §8). What remains is
  *non-version* state poisoning — an update that stays a structurally valid current-version document
  but is semantically undesirable is still applied and persisted; validating projected semantics
  before persist and returning `docError` is the open work.
- **First-sync local-edit loss.** On first connect the client flushes its local working state into
  a blank `Y.Doc` before applying server state (`App.tsx` ~325-332); that blank doc initializes its
  own `flows["flow-1"]` entry, which collides with the server's separate `flows["flow-1"]` `Y.Map`.
  Yjs then resolves the whole flow entry by clientID, so either the local pre-sync edits or the
  persisted server content is lost nondeterministically. This is distinct from the array-clobbering
  gap above (it loses a whole flow, not array elements). Wanted: reconcile against server state
  before seeding, or merge into the server's flow map rather than a competing default.
- **Baseline marked before server acceptance.** The client advances its "last synced" update
  baseline optimistically, before the server has accepted/broadcast the update; a rejected update
  or a tab close in that window drops those edits with no resend. Wanted: only advance the baseline
  on server acknowledgement.

### Core engine / model

**Built** (single shared `evaluate`; verified by `pixi run check`):
- ✅ **Stateful nodes**: `edge`/`rising`/`falling`, `hold(initial)`, `fold`/`scan` (joining
  `toggle`). Each declares a **state-persistence policy** (Q3a): `seed-at-boot` (default,
  ephemeral, restart-safe), `durable` (kept verbatim across a restored memory map),
  `reseed-from-world` (boots initial state from a configured entity's live value). The
  runtime-memory persistence layer that restores `durable` slots on restart
  writes the `Deployer`'s memory slots to
  `RW_DATA_DIR/durable-memory.json` via a debounced `DurableMemoryStore`.
- ✅ **Time / duration / datetime nodes**: `now()` + `since`/`duration` (ms/sec/min/hr), plus
  `datetimeSubtract` (two datetimes → the `duration` between) and `datetimeShift` (a datetime ±
  a `duration`). Time is an explicit injected `now` (epoch ms) param — the server drives a 1 s
  tick, the editor ticks React state, tests pass fixed values. `duration` and `datetime` are
  first-class wire types (D12, §3.1): entities expose `last_changed`/`last_updated` as
  **`datetime`** pins, so "open for 10 min" = `since(door.last_changed) > duration(10,min)`.
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

_Minor follow-ups from review:_ presence/collaborator cursors, `fetch` output-type selector,
variadic shrink-on-disconnect.

### Architecture / tidy-up (built)
- ✅ **Per-node registry**: each node type is a self-contained `NodeDef` under
  `shared/engine/nodes/`; `evaluate` dispatches over it (cross-cutting machinery stays shared).
- ✅ **Shared engine package**: engine + `value`/`results`/`node-types`/`entities`/`theme`/`macros`
  moved to a neutral `shared/` dir both the editor and server import; the `server → frontend/src`
  dependency is severed.
- ✅ **Removed legacy root `src/` dead code**: `ha/` `entity()` getter, the legacy `value.ts`
  Kleene helpers, and `graph.ts`/`types.ts` (plus their now-obsolete tests).
- **Dropped the vestigial `@vue/reactivity` layer**: `src/reactive.ts`
  and `src/value.ts`'s `cell` are deleted; the HA layer now holds live entity state without it
  (see §8).
- (Optional) Stream server-*computed* pin values so the editor is a pure view (D6/D9 refinement)
  — would let the editor drop its in-browser engine.

### Productionization (later)
- **Conda-package node distribution** (D8) + a community index.
- Auth beyond the current deploy-token model (D23) — roles/users/OAuth for exposed multi-user setups.
- Error-UX completeness: node-template ghost-pin healing (D19) is built as read-side def
  reconciliation (§8); entity live-attribute healing and full D20 error UX remain.
