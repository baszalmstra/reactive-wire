#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const serverOut = join(root, "build", "addon-server");
const addonApp = join(root, "reactive_wire", "app");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Missing build input: ${from}`);
  cpSync(from, to, { recursive: true });
}

rmSync(serverOut, { recursive: true, force: true });
rmSync(addonApp, { recursive: true, force: true });
mkdirSync(addonApp, { recursive: true });

run("npx", ["tsc", "-p", "tsconfig.addon.json"]);
run("npm", ["run", "build"], {
  cwd: join(root, "frontend"),
  env: {
    VITE_BASE: "./",
    VITE_RW_SAME_ORIGIN: "1",
  },
});

copy(join(root, "package.json"), join(addonApp, "package.json"));
copy(join(root, "package-lock.json"), join(addonApp, "package-lock.json"));
copy(serverOut, join(addonApp, "server"));
copy(join(root, "frontend", "dist"), join(addonApp, "frontend"));

console.log(`Prepared Home Assistant add-on build context at ${addonApp}`);
