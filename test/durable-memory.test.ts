import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Memory, ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
import { DurableMemoryStore } from "../src/server/durable-memory.js";
import { Deployer } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";

function foldNode(id: string, type = "fold"): NodeData {
  return {
    id, type, title: "", subtitle: "", icon: "mem", x: 0, y: 0, stateful: true,
    config: { persistence: "durable", op: "sum", initial: 0 },
    inputs: [{ id: "value", label: "", type: "num" }, { id: "in", label: "", type: "bool" }],
    outputs: [{ id: "out", label: "", type: "num" }],
  };
}

function seedNode(id: string): NodeData {
  return {
    id, type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0, stateful: true,
    config: { persistence: "seed-at-boot", initial: false },
    inputs: [{ id: "in", label: "", type: "bool" }],
    outputs: [{ id: "state", label: "", type: "bool" }],
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "rw-durable-"));
}

describe("DurableMemoryStore", () => {
  it("restores a durable slot after a simulated restart", () => {
    const dir = tempDir();
    try {
      const nodes = [foldNode("f")];
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      store.restore(nodes, {});
      store.capture(nodes, { f: { state: 42, accumulated: true, prev: true } });
      store.flush();

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore(nodes, mem);
      expect(mem.f).toEqual({ state: 42, accumulated: true, prev: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not persist slots for seed-at-boot nodes", () => {
    const dir = tempDir();
    try {
      const nodes = [seedNode("t")];
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      store.capture(nodes, { t: { state: true } });
      store.flush();

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore(nodes, mem);
      expect(mem.t).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a stored slot when its node is gone from the graph", () => {
    const dir = tempDir();
    try {
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      store.capture([foldNode("f")], { f: { state: 7 } });
      store.flush();

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore([foldNode("g")], mem); // f no longer deployed
      expect(mem.f).toBeUndefined();

      // The dropped slot must not linger: a fresh load of the pruned file no longer knows "f".
      const reloaded = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem2: Memory = {};
      reloaded.restore([foldNode("f")], mem2);
      expect(mem2.f).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips and warns on a slot that cannot round-trip through JSON", () => {
    const dir = tempDir();
    try {
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      store.capture([foldNode("f")], { f: { state: circular } });
      store.flush();
      const warnings = write.mock.calls.filter((c) => String(c[0]).includes(" warn [durable-memory]"));
      expect(warnings).toHaveLength(1);

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore([foldNode("f")], mem);
      expect(mem.f).toBeUndefined();
      write.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deep-copies captured slots so a mutation before the debounced flush does not reach disk", () => {
    const dir = tempDir();
    try {
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 1000 });
      const live: Memory = { f: { state: 3 } };
      store.capture([foldNode("f")], live); // schedules a write but does not flush yet
      (live.f as { state: number }).state = 999; // engine mutates live memory before the flush lands
      store.flush();

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore([foldNode("f")], mem);
      expect(mem.f?.state).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a durable file written by an incompatible version and warns", () => {
    const dir = tempDir();
    try {
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      writeFileSync(join(dir, "durable-memory.json"), JSON.stringify({ version: 2, slots: { f: { type: "fold", mem: { state: 3 } } } }));

      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      store.restore([foldNode("f")], mem);
      expect(mem.f).toBeUndefined();

      const warnings = write.mock.calls.filter((c) => String(c[0]).includes(" warn [durable-memory]") && String(c[0]).includes("version"));
      expect(warnings).toHaveLength(1);
      write.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a stored slot when the node's type changed", () => {
    const dir = tempDir();
    try {
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      store.capture([foldNode("f", "fold")], { f: { state: 9 } });
      store.flush();

      const restarted = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      restarted.restore([foldNode("f", "scan")], mem); // same id, different type
      expect(mem.f).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Deployer durable memory", () => {
  const valNode: NodeData = {
    id: "val", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id: "sensor.v" }, inputs: [], outputs: [{ id: "state", label: "", type: "num" }],
  };
  const trgNode: NodeData = {
    id: "trg", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id: "binary_sensor.t" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }],
  };
  const nodes = [valNode, trgNode, foldNode("f")];
  const edges: ViewEdge[] = [
    { id: "ev", from: { node: "val", pin: "state" }, to: { node: "f", pin: "value" } },
    { id: "et", from: { node: "trg", pin: "state" }, to: { node: "f", pin: "in" } },
  ];

  it("resumes an accumulated fold across a redeploy instead of reseeding", () => {
    const dir = tempDir();
    try {
      const ha = new MockHA();
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const deployer = new Deployer(ha, 100_000, undefined, store);

      ha.setState("sensor.v", "5");
      ha.setState("binary_sensor.t", "off");
      deployer.deploy(nodes, edges, true);
      ha.setState("binary_sensor.t", "on"); // rising edge: fold accumulates 5
      ha.setState("sensor.v", "9"); // trigger still high, no new edge -> stays 5

      // Redeploy the same graph: durable state must be restored so the value is not reseeded to 0.
      deployer.deploy(nodes, edges, true);
      ha.setState("sensor.v", "7"); // trigger still high, still no new edge

      // Read the persisted slot back with a fresh store: an accumulator that reset would show the
      // freshly re-triggered value (7 or 9), not the 5 accumulated before the redeploy.
      const check = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      check.restore(nodes, mem);
      expect(mem.f?.state).toBe(5);

      deployer.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not resume a seed-at-boot stateful node across a redeploy", () => {
    const dir = tempDir();
    try {
      const ha = new MockHA();
      const store = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const deployer = new Deployer(ha, 100_000, undefined, store);
      const seeded = [seedNode("t")];

      deployer.deploy(seeded, [], true);
      deployer.stop();

      // Nothing durable was captured, so a fresh store restores no slot for the toggle.
      const check = new DurableMemoryStore({ dataDir: dir, debounceMs: 0 });
      const mem: Memory = {};
      check.restore(seeded, mem);
      expect(mem.t).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
