Did not write `analysis/server-collab-state-plan.md` because the task also says “Do not modify files”; I left the tree unchanged.

## Server collaboration state plan

### Highest-priority fixes
1. **Restore compile/test health first.**
   - `npm run typecheck` fails: `EditorDocSyncStore` omits `maxStateBytes` and `encodeStateBase64`, while `startFeed()` uses both.
   - Focused collab tests currently have one failure around unsupported-version error identity.

2. **Make server durability authoritative.**
   - Current `EditorDocumentStore.applyUpdate()` mutates the live `Y.Doc` before `persist()`; if persistence fails, memory and disk diverge.
   - Change acceptance order to: validate on shadow doc → durably append/write → mutate authoritative doc → broadcast/ack.

### Recommendations

#### Authoritative document ownership
- Treat the server as the only durable authority. Clients may edit optimistically, but local baselines should advance only after server `docAck`.
- Add `docId`, `clientId`, `updateId`, and server `seq` to doc messages.
- Keep deployed runtime graph separate from editor document state; deploy should target an explicit accepted server document sequence.

#### Update validation
- Strictly validate base64 before decode; reject non-canonical/corrupt updates.
- Continue shadow-doc validation, but also define explicit merge policies:
  - delete-wins via tombstones,
  - prune dangling edges,
  - last-writer-wins only for scalar fields where acceptable.
- Canonicalize/sanitize persisted document projection, not just read-time snapshots.
- Add regression tests for corrupt base64, oversized updates, delete/edit races, dangling edges, and malicious keys.

#### Persistence: append-log plus snapshots
- Replace “full synchronous snapshot per update” with per-doc append logs plus compacted snapshots.
- Minimal migration:
  1. Keep existing `editor-doc.ydoc` as snapshot.
  2. Add `editor-doc.updates` append log with `{seq, clientId, updateId, checksum, bytes}`.
  3. On startup: load snapshot, replay tail log.
  4. Compact after N updates/bytes/time using atomic snapshot rename, then truncate archived log.
- Prefer async queued writes; expose health/backpressure if persistence falls behind.

#### Backpressure, ack, retry
- Server should send `docAck` only after durable acceptance; send `docReject` with `updateId` and reason.
- Client should retain pending updates, merge/coalesce with `Y.mergeUpdates`, and retry on reconnect or missing ack.
- Check browser `ws.bufferedAmount` before sending; pause/coalesce above a low watermark.
- Server should maintain per-client outbound queues and force a `docState` resync if a client falls too far behind.
- Consider binary Yjs frames or a dedicated `/collab/:docId` socket instead of base64 JSON over the entity/deploy feed.

#### Multi-document routing
- Add a `DocManager` keyed by safe `docId` slugs.
- Default missing `docId` to current single document for compatibility.
- Store each doc under its own directory/file; lazy-load and LRU-close inactive docs.
- Authorize per document, not only globally.

#### Security beyond loopback
- Keep loopback default.
- If exposed: require TLS/WSS, exact Host/Origin allowlists, no `*`, rate limits, audit logs, and separate read/write/deploy privileges.
- Avoid long-lived query-string tokens where possible; prefer reverse-proxy auth/session cookies with strict Origin checks or short-lived tokens.
- Require auth when non-loopback `allowedHosts`/`allowedOrigins` are configured, even if the backend bind is loopback behind a proxy.