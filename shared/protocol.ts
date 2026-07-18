import type { DocErrorMessage, DocStateMessage, DocUpdateMessage } from "./collab.js";
import type { EntityMap, EntityState } from "./entities.js";
import type { HAConnectionStatus } from "./ha-status.js";
import { isRecord, parseJsonRecord } from "./json.js";

export interface EntitiesFrame {
  type: "entities";
  version: number;
  entities: EntityMap;
}

/** Full snapshot emitted by servers predating versioned entity feeds. */
export interface LegacyEntitiesFrame {
  type: "entities";
  entities: EntityMap;
}

export interface EntityDeltaFrame {
  type: "entityDelta";
  version: number;
  changed: EntityMap;
  removed: string[];
}

export interface HAStatusFrame {
  type: "haStatus";
  status: HAConnectionStatus;
}

export interface DeployResultFrame {
  type: "deployResult";
  ok: boolean;
  unsupported: string[];
  error?: string;
}

export type ServerFrame = EntitiesFrame | LegacyEntitiesFrame | EntityDeltaFrame | HAStatusFrame | DeployResultFrame | DocStateMessage | DocUpdateMessage | DocErrorMessage;

export interface DeployClientMessage {
  type: "deploy";
  graph: unknown;
  token?: string;
}

export interface DebugStateRequestMessage {
  type: "debugState";
}

/** Opt-in required before the server sends compact entity deltas to this connection. */
export interface ClientCapabilitiesMessage {
  type: "clientCapabilities";
  entityFeed: "delta-v1";
}

export type ClientFrame = DeployClientMessage | DocUpdateMessage | DebugStateRequestMessage | ClientCapabilitiesMessage;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isEntityState(value: unknown): value is EntityState {
  if (!isRecord(value) || typeof value.state !== "string" || !isRecord(value.attributes)) return false;
  const lastChangedOk = value.last_changed === undefined || typeof value.last_changed === "number";
  const lastUpdatedOk = value.last_updated === undefined || typeof value.last_updated === "number";
  return lastChangedOk && lastUpdatedOk;
}

export function isEntityMap(value: unknown): value is EntityMap {
  return isRecord(value) && Object.values(value).every(isEntityState);
}

export function isDocStateMessage(value: unknown): value is DocStateMessage {
  return isRecord(value) && value.type === "docState" && typeof value.update === "string";
}

export function isDocUpdateMessage(value: unknown): value is DocUpdateMessage {
  return isRecord(value) && value.type === "docUpdate" && typeof value.update === "string" && (value.token === undefined || typeof value.token === "string");
}

export function isDocErrorMessage(value: unknown): value is DocErrorMessage {
  return isRecord(value) && value.type === "docError" && typeof value.error === "string";
}

export function isDeployResultFrame(value: unknown): value is DeployResultFrame {
  return isRecord(value)
    && value.type === "deployResult"
    && typeof value.ok === "boolean"
    && Array.isArray(value.unsupported)
    && value.unsupported.every((item) => typeof item === "string")
    && (value.error === undefined || typeof value.error === "string");
}

export function isEntitiesFrame(value: unknown): value is EntitiesFrame | LegacyEntitiesFrame {
  if (!isRecord(value) || value.type !== "entities" || !isEntityMap(value.entities)) return false;
  return value.version === undefined
    || (typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version >= 0);
}

export function isHAStatusFrame(value: unknown): value is HAStatusFrame {
  if (!isRecord(value) || value.type !== "haStatus" || !isRecord(value.status)) return false;
  const phase = value.status.phase;
  const snapshotVersion = value.status.snapshotVersion;
  return (phase === "disconnected" || phase === "syncing" || phase === "ready")
    && typeof value.status.epoch === "number" && Number.isSafeInteger(value.status.epoch) && value.status.epoch >= 0
    && (snapshotVersion === null || (typeof snapshotVersion === "number" && Number.isSafeInteger(snapshotVersion) && snapshotVersion >= 0));
}

export function isEntityDeltaFrame(value: unknown): value is EntityDeltaFrame {
  return isRecord(value)
    && value.type === "entityDelta"
    && typeof value.version === "number"
    && Number.isSafeInteger(value.version)
    && value.version >= 0
    && isEntityMap(value.changed)
    && Array.isArray(value.removed)
    && value.removed.every((id) => typeof id === "string");
}

export function decodeServerFrame(raw: string): ServerFrame | null {
  const value = parseJsonRecord(raw);
  if (!value) return null;
  if (isEntitiesFrame(value) || isEntityDeltaFrame(value) || isHAStatusFrame(value) || isDeployResultFrame(value) || isDocStateMessage(value) || isDocUpdateMessage(value) || isDocErrorMessage(value)) return value;
  return null;
}

export function isDeployClientMessage(value: unknown): value is DeployClientMessage {
  return isRecord(value) && value.type === "deploy" && "graph" in value && (value.token === undefined || typeof value.token === "string");
}

export function isDebugStateRequestMessage(value: unknown): value is DebugStateRequestMessage {
  return isRecord(value) && value.type === "debugState";
}

export function isClientCapabilitiesMessage(value: unknown): value is ClientCapabilitiesMessage {
  return isRecord(value) && value.type === "clientCapabilities" && value.entityFeed === "delta-v1";
}

export function decodeClientFrame(raw: string): ClientFrame | null {
  const value = parseJsonRecord(raw);
  if (!value) return null;
  if (isDeployClientMessage(value) || isDocUpdateMessage(value) || isDebugStateRequestMessage(value) || isClientCapabilitiesMessage(value)) return value;
  return null;
}

export function frameToken(value: unknown): string | null {
  return isRecord(value) ? optionalString(value.token) ?? null : null;
}
