import { spawn, type ChildProcessByStdio, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import type { Readable } from "node:stream";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirName = process.env.E2E_DATA_DIR?.trim() ?? ".rw-data-e2e";
const dataDir = resolve(root, dataDirName);
if (dataDir === root || !dataDir.startsWith(root + sep)) {
  throw new Error(`E2E_DATA_DIR must resolve to a path strictly inside ${root}; got "${dataDirName}" -> "${dataDir}". Refusing to wipe.`);
}
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5175";
const serverPort = process.env.E2E_RW_PORT ?? "7421";
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const isWin = process.platform === "win32";
type ManagedChild = ChildProcessByStdio<null, Readable, Readable>;
const children: ManagedChild[] = [];

type StartOptions = Omit<SpawnOptionsWithoutStdio, "cwd" | "shell" | "stdio"> & {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

function start(name: string, command: string, args: string[], options: StartOptions = {}): ManagedChild {
  const child = spawn(command, args, {
    cwd: root,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`[${name}] exited with code ${code ?? signal}`);
      stopAll();
      process.exit(code ?? 1);
    }
  });
  return child;
}

let stopping = false;
function stopAll(): void {
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(isWin ? undefined : "SIGTERM");
  }
}

process.on("SIGINT", () => { stopAll(); process.exit(130); });
process.on("SIGTERM", () => { stopAll(); process.exit(143); });
process.on("exit", stopAll);

const npmCommand = isWin ? "cmd.exe" : "npm";
const npmArgs = (args: string[]): string[] => isWin ? ["/d", "/s", "/c", ["npm", ...args].join(" ")] : args;

start("server", npmCommand, npmArgs(["run", "start"]), {
  env: {
    ...process.env,
    HA_URL: "",
    HA_TOKEN: "",
    RW_PORT: serverPort,
    RW_HOST: "127.0.0.1",
    RW_DATA_DIR: dataDir,
  },
});

start("frontend", npmCommand, npmArgs(["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1", "--port", frontendPort, "--strictPort"]), {
  env: {
    ...process.env,
    VITE_RW_WS: `ws://127.0.0.1:${serverPort}`,
  },
});

// Keep this parent process alive; Playwright kills it after the test run.
await new Promise(() => {});
