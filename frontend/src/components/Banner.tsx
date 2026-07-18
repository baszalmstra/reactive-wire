/**
 * A full-width bar shown when the editor's server feed is down: values are stale and the live
 * server state is unknown. The connection retries on its own, so the bar only reports state.
 */
export function Banner({ lastSync }: { lastSync: string | null }) {
  return (
    <div className="flex-none flex items-center gap-2.5 px-[14px] h-9 text-[11.5px] text-rw-warn border-b border-[color-mix(in_oklab,var(--rw-h-warn)_45%,var(--rw-line))] bg-[color-mix(in_oklab,var(--rw-h-warn)_12%,var(--rw-panel))] select-none">
      <span className="w-2 h-2 rounded-full bg-rw-warn-fill shrink-0" />
      <span className="min-w-0 truncate">
        {lastSync ? (
          <>
            <b className="font-semibold">Editor feed disconnected.</b> Showing last-known values from {lastSync}. Live server state is unknown; the last deployed graph may still be running.
          </>
        ) : (
          <>
            <b className="font-semibold">No server feed connected.</b> Running a local demo simulation; no graph has been deployed from this editor session.
          </>
        )}
      </span>
      <div className="flex-1" />
      <span className="text-[11px] text-rw-warn/70 shrink-0">Reconnecting…</span>
    </div>
  );
}
