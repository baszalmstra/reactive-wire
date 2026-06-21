I did not write `e:\projects\reactive-wire\analysis\frontend-state-management-plan.md` because the task also said “Do not modify files”; I kept files unchanged and return the plan here.

# Frontend state-management refactor plan

## Current findings

- `frontend/src/App.tsx` currently owns durable document state in React: React Flow `nodes`/`edges`, inactive `flows`, `activeFlowId`, macros, undo/redo stacks, deploy flags, and Yjs refs.
- The client `Y.Doc` is a projection of React state, not the source of truth. Local changes debounce into `applyEditorSnapshotDiff`; remote Yjs snapshots are then rendered back into React.
- This creates fragile seams:
  - duplicated flow/node/edge/macro state;
  - active-flow “stashing” on tab switch;
  - undo only covers some node/edge mutations, not config/value/macro/flow edits;
  - remote updates clear local history;
  - auto-deploy relies on `graphSig` plus suppression flags rather than action origin.

## Target architecture

Use **Yjs as the persistent document source of truth**, wrapped by a small **external editor store**, with a **pure reducer/action layer** for semantics and tests.

### 1. Persistent document source

Keep `shared/collab.ts` as the canonical schema boundary:

- root: `meta`, `flows`, `flowOrder`, `macros`;
- flow: `nodes`, `nodeOrder`, `edges`, `edgeOrder`;
- strip React Flow transient fields such as `selected`.

Change the client mental model:

- The local `Y.Doc` replica is the editor document source for flows/macros/nodes/edges.
- The server-side `EditorDocumentStore` remains the durable sync authority.
- React state should no longer hold a second durable copy of document state.

### 2. External store

Introduce a frontend store, e.g. `frontend/src/state/editor-store.ts`:

- owns the client `Y.Doc`;
- applies server `docState` / `docUpdate`;
- sends local `Y.Doc` updates to the server;
- exposes `subscribe/getSnapshot` via `useSyncExternalStore`;
- exposes typed selectors:
  - `selectFlowTabs`;
  - `selectFlow(flowId)`;
  - `selectActiveFlow(ui.activeFlowId)`;
  - `selectMacros`;
  - `selectDeployableGraph(flowId)`;
  - `selectCanUndo/Redo`.

Avoid storing a full React reducer state as another source of truth. Use the reducer only to define action semantics.

### 3. Action/reducer layer

Define semantic actions independent of React Flow:

- `flow.create`, `flow.rename`, `flow.delete`;
- `node.add`, `node.patchDef`, `node.setPinValue`, `node.move`, `node.delete`;
- `edge.connect`, `edge.delete`;
- `comment.add/update/resize/delete`;
- `macro.save/delete/import`;
- `selection.groupIntoMacro`.

Each action should:

1. validate invariants;
2. produce a next logical snapshot or direct Yjs mutation;
3. run inside one `doc.transact`;
4. carry origin metadata:
   - local vs remote;
   - deploy-relevant vs visual-only;
   - undo label;
   - flow id.

Early phase can reuse `applyEditorSnapshotDiff`; later phase should move hot paths to direct Yjs map/array edits.

### 4. React Flow integration

Make React Flow a controlled view over store selectors:

- `nodes={activeFlow.nodes.map(toReactFlowNode)}`;
- `edges={activeFlow.edges.map(toReactFlowEdge)}`;
- `onNodesChange` maps React Flow changes to domain actions;
- `onEdgesChange` maps deletes/selection to actions or local UI only;
- `onConnect` dispatches `edge.connect`, including variadic pin growth;
- selection remains UI-only.

For drags/resizes, avoid persisting every pointer event blindly:

- capture gesture start;
- update transient UI overlay or throttle Yjs position writes;
- commit one semantic transaction on drag stop;
- group it as one undo item.

### 5. Undo/redo

Replace current snapshot arrays with `Y.UndoManager`.

Recommended first implementation:

- scope to document Yjs types: flows, flow order, macros;
- track only local user origins;
- exclude remote/server origins;
- call `undoManager.stopCapturing()` after each semantic action;
- group drag/resize gestures into one capture;
- undo/redo should sync as normal Yjs updates.

Do not include UI-only state in undo:

- selected nodes;
- open panels;
- viewport;
- toast;
- auto-deploy preference.

Add tests for config/value/macro/flow undo, because current undo does not cover all of them.

### 6. Local UI-only state

Keep a separate lightweight UI reducer/store for:

- `activeFlowId`;
- selection and selected IDs;
- viewport/zoom;
- open panels/sheets/nav;
- connection drag color/state;
- editing macro draft;
- pending config popup;
- toast;
- theme mode;
- deploy modal;
- `autoDeploy`;
- preview evaluation memory;
- simulated entities fallback;
- value history.

`activeFlowId` should be local. If a remote update deletes the active flow, select the first remaining flow locally and clear selection.

### 7. Macro editing

Short term:

- keep `MacroEditor` as an isolated local draft store;
- on save, dispatch one `macro.save` action to Yjs;
- sync macro placements in the same transaction.

Later:

- support collaborative macro editing with a macro-specific Yjs subdocument or edit session, but do not block the main refactor on this.

### 8. Auto-deploy semantics

Make auto-deploy origin-aware and safer.

Rules:

- Manual Deploy always sends the current selected flow.
- Auto-deploy should trigger only for **local semantic deploy-relevant edits**.
- Remote Yjs updates must not auto-deploy through this browser.
- Flow switch alone should not auto-deploy.
- Visual-only edits such as positions/comments should not auto-deploy unless intentionally included.
- Reconnect/replay/offline merge should not actuate automatically without a fresh local edit or explicit confirmation.

Implementation:

- compute `deployableHash(flowId)` from runtime nodes/edges/macros, excluding position/selection/UI;
- store `lastSuccessfulDeployHash`;
- store `lastLocalDeployRelevantEditHash`;
- auto-deploy when:
  - connected;
  - autoDeploy enabled;
  - latest change origin is local;
  - active flow hash differs from last deployed hash;
  - change is deploy-relevant.

Longer term, include deploy hash in `deployResult` so draft/live status survives client refresh more honestly.

## Phased refactor

### Phase 0 — Characterization

- Add tests around current behavior before migration:
  - flow switch preserves inactive flow edits;
  - remote update does not auto-deploy;
  - local auto-deploy does trigger;
  - config/value edits affect preview/deploy;
  - undo coverage gaps are documented.

### Phase 1 — Extract pure document model

- Move snapshot conversions out of `App.tsx`.
- Add pure action functions and tests.
- Keep App behavior unchanged.

### Phase 2 — Add external Yjs store

- Create `EditorDocStore`.
- Move collab sync effects out of `App.tsx`.
- `App` reads document via selectors.
- Still allow snapshot-diff application initially.

### Phase 3 — Migrate React Flow state

- Remove `useNodesState/useEdgesState` as durable state.
- Render active flow from store.
- Dispatch semantic actions from React Flow callbacks.
- Remove active-flow stashing logic.

### Phase 4 — Yjs undo/redo

- Replace `past/future` snapshot arrays with `Y.UndoManager`.
- Add grouped gesture transactions.
- Add undo tests for node config, values, macros, and flow actions.

### Phase 5 — Auto-deploy controller

- Extract deploy logic from `App`.
- Drive it from action origin + deployable hash.
- Add regression tests for remote suppression and flow switching.

### Phase 6 — Macro/editor cleanup

- Make macro save/import/delete store actions.
- Keep macro draft local.
- Add tests for placement sync and invalidated macro pins.

### Phase 7 — Performance/collab polish

- Replace full snapshot diff on hot paths with direct Yjs operations.
- Add structural-sharing selectors.
- Consider queued/callback doc transport instead of latest-frame React state.
- Add optional presence/awareness later.

## Key risks

- Yjs undo with concurrent remote edits can surprise users; test conflict cases carefully.
- React Flow drag events can generate excessive Yjs updates unless batched/throttled.
- Migrating source of truth risks overwriting existing persisted docs; keep schema/version compatibility.
- Active flow must remain local to avoid collaborators fighting over tabs.
- Auto-deploy must never actuate remote/replayed/offline edits accidentally.
- Macro saves touch both macro definitions and placements; these must be atomic.
- Current frontend has limited dedicated state tests; adding a pure model layer first reduces DOM-test burden.