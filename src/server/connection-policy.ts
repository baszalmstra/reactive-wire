import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export interface ConnectionPolicyOptions {
  /** Bind address. Defaults to loopback so deploy/control is not exposed by accident. */
  host?: string;
  /** Extra Host header names accepted in addition to loopback hosts. Use only when intentionally exposing the server. */
  allowedHosts?: string[];
  /** Extra browser Origin values accepted in addition to loopback/null local-file origins. */
  allowedOrigins?: string[];
  /** Optional deploy/control token; when set, clients must provide it as a `token` query parameter. */
  deployToken?: string;
  /** Trust an upstream Home Assistant/Supervisor ingress proxy as the auth boundary. */
  trustedIngress?: boolean;
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function hostName(hostHeader: string): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`ws://${hostHeader}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return hostHeader.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase() ?? null;
  }
}

export function normalizeAllowedHost(host: string): string {
  if (host === "*") return "*";
  try {
    return hostName(host.includes("://") ? new URL(host).host : host) ?? host.toLowerCase();
  } catch {
    return hostName(host) ?? host.toLowerCase();
  }
}

export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  // Only numeric IPv4 loopback addresses are accepted here. A hostname such as
  // `127.attacker.example` may resolve to localhost via DNS rebinding but is not itself a
  // loopback literal, so it must not satisfy the default no-token local deploy policy.
  return isIP(h) === 4 && h.split(".")[0] === "127";
}

function isAllowedHost(req: IncomingMessage, options: ConnectionPolicyOptions): boolean {
  if (options.trustedIngress) return true;
  const host = hostName(header(req, "host"));
  const allowed = (options.allowedHosts ?? []).map((h) => normalizeAllowedHost(h));
  return allowed.includes("*") || isLoopbackHost(host) || (host ? allowed.includes(host) : false);
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "").toLowerCase();
}

function isAllowedOrigin(req: IncomingMessage, options: ConnectionPolicyOptions): boolean {
  if (options.trustedIngress) return true;
  const origin = header(req, "origin");
  if (!origin) return true;
  const host = hostName(header(req, "host"));
  // Browser connections from a local standalone file use Origin: null. Keep that convenient only
  // for loopback connections; exposed servers should use explicit allowed origins and/or a token.
  if (origin === "null") return isLoopbackHost(host);
  const allowed = (options.allowedOrigins ?? []).map((o) => normalizeOrigin(o));
  if (allowed.includes("*")) return true;
  if (allowed.includes(normalizeOrigin(origin))) return true;
  if (allowed.length > 0) return false;
  try {
    return isLoopbackHost(new URL(origin).hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

export function requestToken(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? "/", "ws://reactive-wire.local");
    return url.searchParams.get("token") ?? url.searchParams.get("rw_token");
  } catch {
    return null;
  }
}

export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateConnection(req: IncomingMessage, options: ConnectionPolicyOptions): { status: number; message: string } | null {
  const bindHost = normalizeAllowedHost(options.host ?? "127.0.0.1");
  if (!options.deployToken && !options.trustedIngress && !isLoopbackHost(bindHost)) {
    return { status: 401, message: "RW_DEPLOY_TOKEN is required when binding outside loopback" };
  }
  if (!isAllowedHost(req, options)) return { status: 403, message: "WebSocket Host is not allowed" };
  if (!isAllowedOrigin(req, options)) return { status: 403, message: "WebSocket Origin is not allowed" };
  if (!tokenMatches(requestToken(req), options.deployToken)) return { status: 401, message: "Invalid deploy token" };
  return null;
}
