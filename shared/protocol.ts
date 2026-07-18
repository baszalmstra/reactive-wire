import type { DocErrorMessage, DocResetAckMessage, DocResetMessage, DocStateMessage, DocUpdateMessage } from "./collab.js";
import type { EntityMap, EntityState } from "./entities.js";
import type { HAConnectionStatus } from "./ha-status.js";
import { isHomeLocation, type HomeLocation } from "./home.js";
import { isRecord, parseJsonRecord } from "./json.js";
import type { ServiceCall } from "./results.js";
import type { ValueType } from "./runtime-types.js";
import type { Status } from "./value.js";

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

export interface HomeLocationFrame {
  type: "homeLocation";
  location: HomeLocation | null;
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

/** Server-owned action history for one deployed sink. */
export interface RuntimeSinkState {
  desired: ServiceCall | null;
  note?: string;
  status: Status;
  lastCall: ServiceCall | null;
  lastTriggeredAt: number | null;
}

/** JSON-safe server value retained for output-pin history. */
export interface RuntimeValueState {
  type: ValueType;
  status: Status;
  value: unknown;
  msg?: string;
}

export interface RuntimeValueSample {
  value: RuntimeValueState;
  t: number;
}

/** Live deployed-runtime state pushed to editor clients on connect and runtime changes. */
export interface RuntimeStateFrame {
  type: "runtimeState";
  deployed: boolean;
  generation: number;
  mode: "live" | "dry-run";
  graphFingerprint: string | null;
  sinks: Record<string, RuntimeSinkState>;
  /** Bounded output-pin samples retained by the server, keyed by namespaced runtime pin id. */
  history: Record<string, RuntimeValueSample[]>;
}

export type ServerFrame = EntitiesFrame | LegacyEntitiesFrame | EntityDeltaFrame | HomeLocationFrame | HAStatusFrame | DeployResultFrame | RuntimeStateFrame | DocStateMessage | DocUpdateMessage | DocErrorMessage | DocResetMessage;

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

export type ClientFrame = DeployClientMessage | DocUpdateMessage | DocResetAckMessage | DebugStateRequestMessage | ClientCapabilitiesMessage;

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

export function isDocResetMessage(value: unknown): value is DocResetMessage {
  return isRecord(value) && value.type === "docReset" && typeof value.update === "string"
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 0 && typeof value.error === "string";
}

export function isDocResetAckMessage(value: unknown): value is DocResetAckMessage {
  return isRecord(value) && value.type === "docResetAck"
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 0
    && (value.token === undefined || typeof value.token === "string");
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

function isServiceCall(value: unknown): value is ServiceCall {
  if (!isRecord(value) || typeof value.domain !== "string" || typeof value.service !== "string" || !isRecord(value.data)) return false;
  return value.target === undefined
    || (isRecord(value.target) && typeof value.target.entity_id === "string");
}

function isRuntimeSinkState(value: unknown): value is RuntimeSinkState {
  if (!isRecord(value)) return false;
  const status = value.status;
  return (value.desired === null || isServiceCall(value.desired))
    && (value.note === undefined || typeof value.note === "string")
    && (status === "ok" || status === "stale" || status === "unavailable" || status === "error")
    && (value.lastCall === null || isServiceCall(value.lastCall))
    && (value.lastTriggeredAt === null || (typeof value.lastTriggeredAt === "number" && Number.isFinite(value.lastTriggeredAt)));
}

function isRuntimeValueState(value: unknown): value is RuntimeValueState {
  if (!isRecord(value)) return false;
  const type = value.type;
  const status = value.status;
  if ((type !== "num" && type !== "bool" && type !== "str" && type !== "color" && type !== "datetime" && type !== "duration" && type !== "any")
    || (status !== "ok" && status !== "stale" && status !== "unavailable" && status !== "error")
    || !("value" in value)
    || (value.msg !== undefined && typeof value.msg !== "string")) return false;
  if (status === "unavailable" || status === "error") return value.value === null;
  if (type === "bool") return typeof value.value === "boolean";
  if (type === "num" || type === "duration" || type === "datetime") return typeof value.value === "number" && Number.isFinite(value.value);
  if (type === "str" || type === "color") return typeof value.value === "string";
  return true;
}

function isRuntimeValueSample(value: unknown): value is RuntimeValueSample {
  return isRecord(value)
    && isRuntimeValueState(value.value)
    && typeof value.t === "number" && Number.isFinite(value.t);
}

export function isRuntimeStateFrame(value: unknown): value is RuntimeStateFrame {
  return isRecord(value)
    && value.type === "runtimeState"
    && typeof value.deployed === "boolean"
    && Number.isSafeInteger(value.generation) && (value.generation as number) >= 0
    && (value.mode === "live" || value.mode === "dry-run")
    && (value.graphFingerprint === null || typeof value.graphFingerprint === "string")
    && isRecord(value.sinks)
    && Object.values(value.sinks).every(isRuntimeSinkState)
    && isRecord(value.history)
    && Object.values(value.history).every((samples) => Array.isArray(samples) && samples.every(isRuntimeValueSample));
}

export function isHomeLocationFrame(value: unknown): value is HomeLocationFrame {
  return isRecord(value) && value.type === "homeLocation"
    && (value.location === null || isHomeLocation(value.location));
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
  if (isEntitiesFrame(value) || isEntityDeltaFrame(value) || isHomeLocationFrame(value) || isHAStatusFrame(value) || isDeployResultFrame(value) || isRuntimeStateFrame(value) || isDocStateMessage(value) || isDocUpdateMessage(value) || isDocErrorMessage(value) || isDocResetMessage(value)) return value;
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
  if (isDeployClientMessage(value) || isDocUpdateMessage(value) || isDocResetAckMessage(value) || isDebugStateRequestMessage(value) || isClientCapabilitiesMessage(value)) return value;
  return null;
}

export function frameToken(value: unknown): string | null {
  return isRecord(value) ? optionalString(value.token) ?? null : null;
}
