import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MockHA } from "../src/ha/mock.js";
import { startFeed } from "../src/server/feed.js";

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

async function fetchEventually(url: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < 20; i += 1) {
    try {
      return await fetch(url);
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw last;
}

function firstFrame(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { origin: "https://homeassistant.local" } });
    ws.once("message", (raw) => {
      ws.close();
      resolve(JSON.parse(String(raw)) as Record<string, unknown>);
    });
    ws.once("error", reject);
  });
}

describe("feed static editor hosting", () => {
  it("serves built editor assets and accepts ingress-subpath WebSockets", async () => {
    const port = await freePort();
    const dir = await mkdtemp(join(tmpdir(), "rw-static-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<html><script src=\"./assets/app.js\"></script></html>");
    await writeFile(join(dir, "assets", "app.js"), "console.log('rw')");

    const ha = new MockHA();
    const stop = startFeed(ha, { port, host: "127.0.0.1", staticDir: dir, trustedIngress: true });
    try {
      const root = await fetchEventually(`http://127.0.0.1:${port}/api/hassio_ingress/abc123/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("./assets/app.js");

      const asset = await fetch(`http://127.0.0.1:${port}/api/hassio_ingress/abc123/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("console.log");

      const frame = await firstFrame(`ws://127.0.0.1:${port}/api/hassio_ingress/abc123/`);
      expect(frame.type).toBe("entities");
    } finally {
      stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
