# Research: Yjs transport options beyond homegrown JSON WebSocket frames

## Summary
Replace base64 JSON `docState`/`docUpdate` frames with a standard Yjs binary provider unless the app has unusual transport constraints. For a React + Vite client and Node/`ws` backend, the lowest-risk path is either **Hocuspocus** if you want production auth/persistence hooks now, or **`y-websocket` protocol/server code adapted into the existing server** if you want minimal change and can own backend hardening. Keep a custom transport only if it still uses `y-protocols/sync` + `y-protocols/awareness` binary messages, state-vector handshakes, and tested reconnect semantics.

## Findings
1. **Current base64 JSON frames are compatible with Yjs but leave protocol work to us.** Yjs updates are binary `Uint8Array`s; docs explicitly say JSON cannot represent them directly, base64 is only a workaround, and most communication protocols can carry binary data. Yjs state-vector sync (`encodeStateVector`, `encodeStateAsUpdate(doc, stateVector)`) avoids resending full state and incremental `doc.on('update')` events are the expected persistence/broadcast unit. [Yjs document updates](https://docs.yjs.dev/api/document-updates)

2. **`y-websocket` is the simplest standard replacement for custom frames.** It already distributes Yjs document updates and awareness over WebSocket, supports cross-tab BroadcastChannel/localStorage sync, exposes connection/sync status (`wsconnected`, `wsconnecting`, `synced`, `status`, `sync`), supports reconnect control via `shouldConnect`, `connect()`, and `disconnect()`, and accepts auth parameters/cookies/headers because it is a normal WebSocket connection. [Yjs y-websocket docs](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket)

3. **Do not treat the stock `y-websocket-server` as a complete production backend.** The server README says it is a development server or starting point; it is intentionally small and should be forked/adapted or replaced by a fuller backend for production persistence, scaling, authentication, and presence. Its persistence hook shape is minimal (`bindState`, `writeState`) and durable persistence is recommended via production backends such as YHub or Hocuspocus. [y-websocket-server README](https://github.com/yjs/y-websocket-server/)

4. **Hocuspocus gives the strongest auth and application integration surface.** It has `onAuthenticate` for per-document auth, can reject connections, return contextual user data for later hooks, set `connection.readOnly`, and supports token synchronization during active sessions. Its hook lifecycle also includes `beforeHandleMessage`, `beforeHandleAwareness`, `onAwarenessUpdate`, `onLoadDocument`, `onStoreDocument`, `onDisconnect`, and HTTP/upgrade hooks. [Hocuspocus authentication](https://tiptap.dev/docs/hocuspocus/guides/authentication), [Hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks)

5. **Hocuspocus persistence is more explicit and safer than ad hoc JSON snapshots.** It recommends loading/storing Yjs documents through `onLoadDocument` and debounced `onStoreDocument`, or using database extensions such as generic Database, SQLite, or S3. It warns not to store a Y.Doc as JSON and recreate binary on connect, because this breaks Yjs history/merge semantics and can duplicate content; primary storage should be Yjs binary `Uint8Array`. [Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence)

6. **`y-protocols/sync` over existing `ws` is the best custom-middle-ground if we must keep the current socket server.** The protocol specifies binary `SyncStep1` with state vector, `SyncStep2` with missing update, and `Update` for subsequent document updates. In client-server topology, the client sends `SyncStep1`, the server replies `SyncStep2` and its own `SyncStep1`; later local changes are sent as `Update`. This directly addresses reconnect/state-vector sync gaps while preserving the current Node/`ws` server. [y-protocols protocol spec](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)

7. **Awareness/presence should use the standard awareness protocol, not document updates.** Awareness is an ephemeral CRDT for per-client state such as cursors; it is separate from the Yjs document, has no history, and clients should be removed after stale state. The protocol spec notes awareness payloads are not authenticated by the protocol itself, so verified identity must be enforced at the app/server layer. [Yjs awareness docs](https://docs.yjs.dev/api/about-awareness), [y-protocols protocol spec](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md)

8. **`y-leveldb` is useful for simple single-node persistence, but it is deprecated.** It stores incremental updates, exposes `getYDoc`, `storeUpdate`, `getStateVector`, and `getDiff`, and can be used with `y-websocket`; however, its README is marked deprecated, so it should not be the strategic production choice unless the app only needs local/dev or legacy single-node persistence. [y-leveldb README](https://github.com/yjs/y-leveldb)

9. **`y-redis`/YHub-style backend is for scale, but carries operational and licensing cost.** The README describes a y-websocket-compatible Redis-backed backend with Redis streams/pubsub, worker persistence, PostgreSQL/S3 storage, no long-lived in-memory `Y.Doc` on the server after initial sync, horizontal server instances without coordination, and external auth callbacks. It is beta and dual-licensed AGPL/proprietary, so it is a poor first migration target unless multi-instance scale is already required. [y-redis/YHub README](https://github.com/yjs/y-redis)

## Comparison
| Option | Auth hooks | Reconnect/state-vector sync | Presence/awareness | Persistence | Operational complexity | Fit |
|---|---|---|---|---|---|---|
| `y-websocket` provider + adapted server | Use cookies/headers/query params; custom server code must enforce auth | Built-in provider protocol and sync events | Built in | Server persistence hook; LevelDB examples; production durability is on us | Low to medium | Best minimal migration from custom JSON frames |
| Hocuspocus | Strong: `onAuthenticate`, read-only, token sync, message/awareness hooks | Built into provider/server | Built in with awareness hooks and rewrite/reject options | Strong: `onLoadDocument`, debounced `onStoreDocument`, DB/SQLite/S3 extensions | Medium | Best recommendation for production app integration |
| `y-protocols/sync` over existing `ws` | Fully custom | Standard state-vector handshake if implemented correctly | Standard if `awareness` protocol implemented | Fully custom; can pair with app DB | Medium to high | Good only if existing WS routing/protocol must remain |
| `y-leveldb` | None by itself | Helps diff by state vector at DB layer | None by itself | Simple embedded persistence; deprecated | Low | Dev/single-node only, not strategic |
| `y-redis` / YHub | External auth callback/read-only model | y-websocket-compatible scalable sync | Intended production presence path | Redis + worker + Postgres/S3/S3-compatible storage | High | Later scale-out option, not first step |

## Recommendations
1. **Preferred production path: adopt Hocuspocus.** It gives the app-level controls missing from homegrown frames: per-document authentication, read-only enforcement, token refresh, awareness sanitization, debounced binary persistence hooks, and a tested provider/server pair.
2. **Lowest-risk incremental path: switch the client to `y-websocket` and adapt/fork `y-websocket-server` into the existing Node server.** Keep current session/cookie auth at WebSocket upgrade, but replace JSON message types with binary standard provider messages.
3. **If retaining the existing WS route is mandatory, implement `y-protocols/sync` and `y-protocols/awareness` exactly instead of inventing another JSON envelope.** Use binary WebSocket frames, client `SyncStep1` on connect/reconnect, server `SyncStep2` diff response, server `SyncStep1`, then incremental `Update` frames.
4. **Do not migrate persistence to JSON snapshots.** Persist binary updates or merged binary document state. Base64 can be accepted temporarily for migration at API boundaries, but storage and transport should move to `Uint8Array`/Buffer.
5. **Defer `y-redis`/YHub until there is a demonstrated need for multi-instance horizontal scaling.** It solves real scaling concerns but adds Redis, worker, object/blob storage, Postgres, auth service integration, and AGPL/proprietary licensing review.

## Migration path from base64 `docState`/`docUpdate` frames
1. **Inventory current frame semantics.** Map `docState` to `Y.encodeStateAsUpdate`/snapshot payloads and `docUpdate` to `doc.on('update')` incremental updates.
2. **Add binary support first.** Ensure client and Node/`ws` server send/receive `ArrayBuffer`/`Uint8Array`/`Buffer` frames without JSON/base64. Keep legacy base64 decode as compatibility fallback during rollout.
3. **Introduce state-vector handshake.** On connect/reconnect, client sends state vector (`SyncStep1` or equivalent). Server computes missing diff (`SyncStep2`) instead of sending full `docState`; server also requests the client diff with its own `SyncStep1`.
4. **Add awareness separately.** Use `Awareness` from `y-protocols/awareness`; never persist cursor/presence in the Y.Doc.
5. **Move persistence to binary.** Store incoming incremental updates and/or merged `encodeStateAsUpdate` blobs. If current DB stores base64, decode to bytes once and write a binary/blob column or Buffer-backed object storage.
6. **Cut over provider.** Prefer Hocuspocus or `y-websocket` provider on the React side; remove custom JSON frame handling once all supported clients speak the standard provider protocol.

## When custom transport is justified
Custom transport is justified only when there is a hard product/platform need that stock providers cannot satisfy: multiplexing collaboration through an existing non-WebSocket channel, strict message broker requirements, custom offline/edge topology, unusual auth/session constraints, or staged migration that cannot expose a separate provider endpoint. Even then, the custom layer should be a transport adapter for `y-protocols/sync` and `y-protocols/awareness`, not a new Yjs protocol.

## Sources
- Kept: Yjs document updates (https://docs.yjs.dev/api/document-updates) — primary API evidence for binary updates, base64 caveat, state vectors, diffs, and custom provider template.
- Kept: y-websocket docs (https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) — primary provider evidence for auth suitability, awareness, cross-tab sync, status, and persistence/scaling notes.
- Kept: y-websocket-server README (https://github.com/yjs/y-websocket-server/) — primary evidence that stock server is a starting point/development server and persistence is minimal.
- Kept: Hocuspocus authentication (https://tiptap.dev/docs/hocuspocus/guides/authentication) — primary evidence for auth hook, contextual data, client token, and read-only mode.
- Kept: Hocuspocus hooks (https://tiptap.dev/docs/hocuspocus/server/hooks) — primary evidence for hook lifecycle, token sync, message filtering, awareness hooks, load/store hooks.
- Kept: Hocuspocus persistence (https://tiptap.dev/docs/hocuspocus/guides/persistence) — primary evidence for binary persistence and warning against JSON recreation.
- Kept: y-protocols protocol spec (https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md) — primary evidence for sync/awareness binary wire format and handshake.
- Kept: y-leveldb README (https://github.com/yjs/y-leveldb) — primary evidence for LevelDB adapter API and deprecation status.
- Kept: y-redis/YHub README (https://github.com/yjs/y-redis) — primary evidence for Redis-backed scaling architecture, persistence components, auth model, beta/licensing status.
- Dropped: SEO/tutorial posts and redundant mirrored docs — excluded because primary docs and repository READMEs answered the question more directly.

## Gaps
- I did not inspect the app's existing WS/auth/persistence code, per the no-modify research-only scope, so migration effort estimates are directional.
- Hocuspocus version/API should be pinned during implementation; docs cited are current as of 2026-06-21 and mention v4/Node 22+ behavior.
- Licensing review is needed before using y-redis/YHub in a commercial closed-source product due AGPL/proprietary licensing.
