export type HAConnectionPhase = "disconnected" | "syncing" | "ready";

/** Transport and fresh-snapshot readiness for one Home Assistant connection epoch. */
export interface HAConnectionStatus {
  phase: HAConnectionPhase;
  epoch: number;
  snapshotVersion: number | null;
}
