#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runtimePackage() {
  const rootPackage = readJson(join(root, "package.json"));
  const rootLock = readJson(join(root, "package-lock.json"));
  const dependencies = {};
  for (const name of Object.keys(rootPackage.dependencies ?? {}).sort()) {
    const locked = rootLock.packages?.[`node_modules/${name}`]?.version;
    dependencies[name] = locked ?? rootPackage.dependencies[name];
  }
  return {
    name: rootPackage.name,
    version: rootPackage.version,
    description: rootPackage.description,
    type: rootPackage.type,
    private: true,
    scripts: {
      start: "node server/src/server/index.js",
    },
    dependencies,
  };
}

rmSync(serverOut, { recursive: true, force: true });
rmSync(addonApp, { recursive: true, force: true });
mkdirSync(addonApp, { recursive: true });

run("npx", ["--no-install", "tsc", "-p", "tsconfig.addon.json"]);
run("npm", ["run", "build"], {
  cwd: join(root, "frontend"),
  env: {
    VITE_BASE: "./",
    VITE_RW_SAME_ORIGIN: "1",
  },
});

writeJson(join(addonApp, "package.json"), runtimePackage());
run("npm", ["install", "--package-lock-only", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: addonApp });
copy(join(root, "pixi.toml"), join(addonApp, "pixi.toml"));
copy(join(root, "pixi.lock"), join(addonApp, "pixi.lock"));
copy(serverOut, join(addonApp, "server"));
copy(join(root, "frontend", "dist"), join(addonApp, "frontend"));

console.log(`Prepared Home Assistant add-on build context at ${addonApp}`);
