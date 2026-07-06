#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const serverOut = join(root, "build", "addon-server");
const addonApp = join(root, "reactive_wire", "app");

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  type?: string;
  dependencies?: Record<string, string>;
  packages?: Record<string, { version?: string }>;
}

function run(command: string, args: string[], options: RunOptions = {}): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copy(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`Missing build input: ${from}`);
  cpSync(from, to, { recursive: true });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runtimePackage(): Required<Pick<PackageJson, "name" | "version" | "description" | "type">> & {
  private: true;
  scripts: { start: string };
  dependencies: Record<string, string>;
} {
  const rootPackage = readJson<PackageJson>(join(root, "package.json"));
  const rootLock = readJson<PackageJson>(join(root, "package-lock.json"));
  const dependencies: Record<string, string> = {};
  for (const name of Object.keys(rootPackage.dependencies ?? {}).sort()) {
    const locked = rootLock.packages?.[`node_modules/${name}`]?.version;
    dependencies[name] = locked ?? rootPackage.dependencies![name]!;
  }
  return {
    name: rootPackage.name ?? "reactive-wire",
    version: rootPackage.version ?? "0.0.0",
    description: rootPackage.description ?? "Reactive Wire",
    type: rootPackage.type ?? "module",
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
    ...process.env,
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
