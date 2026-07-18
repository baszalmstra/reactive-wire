import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { validateConnection } from "../src/server/connection-policy.js";
import { sanitizeDeployRequest } from "../src/server/deploy-validation.js";

function req(host: string, origin?: string, url = "/"): IncomingMessage {
  return { headers: { host, ...(origin !== undefined ? { origin } : {}) }, url } as IncomingMessage;
}

describe("deploy graph validation", () => {
  it("accepts a minimal well-formed graph and sanitizes optional fields", () => {
    const result = sanitizeDeployRequest({
      nodes: [{ id: "n1", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 1, y: 2, inputs: [], outputs: [{ id: "out", label: "out", type: "num", editable: true }] }],
      edges: [],
      macros: {},
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.nodes[0]?.id).toBe("n1");
      expect(result.graph.nodes[0]?.outputs[0]?.type).toBe("num");
    }
  });

  it("rejects edges that reference unknown nodes instead of letting malformed deploys crash later", () => {
    const result = sanitizeDeployRequest({
      nodes: [{ id: "n1", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "out", type: "num" }] }],
      edges: [{ id: "e", from: { node: "n1", pin: "out" }, to: { node: "missing", pin: "in" } }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown node");
  });

  it("enforces the shared typed-DAG semantics at the deployment boundary", () => {
    const number = { id: "n", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "out", type: "num", editable: true }], values: { out: 1 } };
    const not = (id: string) => ({ id, type: "not", title: "NOT", subtitle: "", icon: "cmp", x: 0, y: 0, inputs: [{ id: "in", label: "in", type: "bool" }], outputs: [{ id: "out", label: "not", type: "bool" }] });

    const mismatch = sanitizeDeployRequest({
      nodes: [number, not("not")],
      edges: [{ id: "e", from: { node: "n", pin: "out" }, to: { node: "not", pin: "in" } }],
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toContain("connects num to bool");

    const cyclic = sanitizeDeployRequest({
      nodes: [not("a"), not("b")],
      edges: [
        { id: "ab", from: { node: "a", pin: "out" }, to: { node: "b", pin: "in" } },
        { id: "ba", from: { node: "b", pin: "out" }, to: { node: "a", pin: "in" } },
      ],
    });
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) expect(cyclic.error).toContain("creates a cycle");

    const unknownType = sanitizeDeployRequest({ nodes: [{ ...number, type: "not-registered" }], edges: [] });
    expect(unknownType.ok).toBe(false);
    if (!unknownType.ok) expect(unknownType.error).toContain("Unknown node type");
  });

  it("rejects prototype-sensitive graph identifiers", () => {
    const reservedNode = sanitizeDeployRequest({
      nodes: [{ id: "__proto__", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [] }],
      edges: [],
    });
    expect(reservedNode.ok).toBe(false);
    if (!reservedNode.ok) expect(reservedNode.error).toContain("reserved identifier");

    const reservedPin = sanitizeDeployRequest({
      nodes: [{ id: "n", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "constructor", label: "out", type: "num" }] }],
      edges: [],
    });
    expect(reservedPin.ok).toBe(false);

    const reservedMacro = sanitizeDeployRequest({
      nodes: [],
      edges: [],
      macros: { safe: { id: "prototype", name: "Bad", inputs: [], outputs: [], nodes: [], edges: [] } },
    });
    expect(reservedMacro.ok).toBe(false);

    const reservedMacroKey = sanitizeDeployRequest(JSON.parse(`{
      "nodes": [], "edges": [],
      "macros": { "__proto__": { "id": "safe", "name": "Bad", "inputs": [], "outputs": [], "nodes": [], "edges": [] } }
    }`));
    expect(reservedMacroKey.ok).toBe(false);
    if (!reservedMacroKey.ok) expect(reservedMacroKey.error).toContain("reserved identifier");
  });

  it("rejects cumulative macro expansion beyond the runtime budget", () => {
    const innerNodes = Array.from({ length: 11 }, (_, i) => ({
      id: `inner-${i}`,
      type: "const-number",
      title: "Number",
      subtitle: "",
      icon: "const",
      x: 0,
      y: 0,
      inputs: [],
      outputs: [{ id: "out", label: "out", type: "num" }],
      values: { out: i },
    }));
    const placements = Array.from({ length: 1_000 }, (_, i) => ({
      id: `placement-${i}`,
      type: "macro",
      title: "Wide",
      subtitle: "",
      icon: "macro",
      x: 0,
      y: 0,
      inputs: [],
      outputs: [],
      config: { macroId: "wide" },
    }));

    const result = sanitizeDeployRequest({
      nodes: placements,
      edges: [],
      macros: {
        wide: { id: "wide", name: "Wide", inputs: [], outputs: [], nodes: innerNodes, edges: [], stateful: false },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Expanded graph exceeds 10000 nodes");
  });

  it("drops prototype-polluting keys from config and values", () => {
    const payload = JSON.parse(`{
      "nodes": [{
        "id": "n1", "type": "const-number", "title": "Number", "subtitle": "", "icon": "const", "x": 0, "y": 0,
        "config": { "safe": 1, "__proto__": { "polluted": true }, "constructor": { "prototype": { "polluted": true } } },
        "values": { "out": 7, "prototype": { "polluted": true } },
        "inputs": [], "outputs": [{ "id": "out", "label": "out", "type": "num" }]
      }],
      "edges": []
    }`);

    const result = sanitizeDeployRequest(payload);

    expect(result.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (result.ok) {
      expect(result.graph.nodes[0]?.config).toEqual({ safe: 1 });
      expect(result.graph.nodes[0]?.values).toEqual({ out: 7 });
      expect(result.graph.nodes[0]?.outputs[0]?.type).toBe("num");
    }
  });
});

describe("deploy WebSocket connection guards", () => {
  it("allows loopback hosts/origins by default", () => {
    expect(validateConnection(req("127.0.0.1:7420", "http://localhost:5173"), {})).toBeNull();
    expect(validateConnection(req("localhost:7420", "null"), {})).toBeNull();
  });

  it("does not treat DNS-rebinding-looking hostnames as loopback", () => {
    const rejectedHost = validateConnection(req("127.attacker.example:7420", "http://localhost:5173"), {});
    expect(rejectedHost?.status).toBe(403);
    expect(rejectedHost?.message).toContain("Host");

    const rejectedOrigin = validateConnection(req("127.0.0.1:7420", "http://127.attacker.example:5173"), {});
    expect(rejectedOrigin?.status).toBe(403);
    expect(rejectedOrigin?.message).toContain("Origin");
  });

  it("requires the configured deploy token on the connection URL", () => {
    expect(validateConnection(req("127.0.0.1:7420", "http://localhost:5173", "/?token=secret"), { deployToken: "secret" })).toBeNull();
    const rejected = validateConnection(req("127.0.0.1:7420", "http://localhost:5173", "/?token=wrong"), { deployToken: "secret" });
    expect(rejected?.status).toBe(401);
  });

  it("requires a deploy token when the WebSocket binds outside loopback even if Host is spoofed", () => {
    const rejected = validateConnection(req("127.0.0.1:7420"), { host: "0.0.0.0" });

    expect(rejected?.status).toBe(401);
    expect(rejected?.message).toContain("RW_DEPLOY_TOKEN");
  });

  it("can trust Home Assistant ingress as the external auth boundary", () => {
    expect(validateConnection(req("homeassistant.local", "https://homeassistant.local"), { host: "0.0.0.0", trustedIngress: true })).toBeNull();
  });
});
