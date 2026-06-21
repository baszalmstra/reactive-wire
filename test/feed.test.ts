import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { sanitizeDeployRequest, validateConnection } from "../src/server/feed.js";

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

  it("drops prototype-polluting keys from config and values", () => {
    const payload = JSON.parse(`{
      "nodes": [{
        "id": "n1", "type": "const-number", "title": "Number", "subtitle": "", "icon": "const", "x": 0, "y": 0,
        "config": { "safe": 1, "__proto__": { "polluted": true }, "constructor": { "prototype": { "polluted": true } } },
        "values": { "out": 7, "prototype": { "polluted": true } },
        "inputs": [], "outputs": [{ "id": "out", "label": "out", "type": "definitely-not-a-type" }]
      }],
      "edges": []
    }`);

    const result = sanitizeDeployRequest(payload);

    expect(result.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (result.ok) {
      expect(result.graph.nodes[0]?.config).toEqual({ safe: 1 });
      expect(result.graph.nodes[0]?.values).toEqual({ out: 7 });
      expect(result.graph.nodes[0]?.outputs[0]?.type).toBe("any");
    }
  });
});

describe("deploy WebSocket connection guards", () => {
  it("allows loopback hosts/origins by default", () => {
    expect(validateConnection(req("127.0.0.1:7420", "http://localhost:5173"), { port: 7420 })).toBeNull();
    expect(validateConnection(req("localhost:7420", "null"), { port: 7420 })).toBeNull();
  });

  it("does not treat DNS-rebinding-looking hostnames as loopback", () => {
    const rejectedHost = validateConnection(req("127.attacker.example:7420", "http://localhost:5173"), { port: 7420 });
    expect(rejectedHost?.status).toBe(403);
    expect(rejectedHost?.message).toContain("Host");

    const rejectedOrigin = validateConnection(req("127.0.0.1:7420", "http://127.attacker.example:5173"), { port: 7420 });
    expect(rejectedOrigin?.status).toBe(403);
    expect(rejectedOrigin?.message).toContain("Origin");
  });

  it("requires the configured deploy token on the connection URL", () => {
    expect(validateConnection(req("127.0.0.1:7420", "http://localhost:5173", "/?token=secret"), { port: 7420, deployToken: "secret" })).toBeNull();
    const rejected = validateConnection(req("127.0.0.1:7420", "http://localhost:5173", "/?token=wrong"), { port: 7420, deployToken: "secret" });
    expect(rejected?.status).toBe(401);
  });

  it("requires a deploy token when the WebSocket binds outside loopback even if Host is spoofed", () => {
    const rejected = validateConnection(req("127.0.0.1:7420"), { port: 7420, host: "0.0.0.0" });

    expect(rejected?.status).toBe(401);
    expect(rejected?.message).toContain("RW_DEPLOY_TOKEN");
  });
});
