#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const notes = (process.env.RELEASE_NOTES ?? process.argv.slice(3).join(" ")).trim() || `Release ${version}.`;

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: npx tsx scripts/prepare-release.ts <semver> [notes]");
  process.exit(1);
}
const releaseVersion = version;

interface VersionedJson {
  version?: string;
  packages?: Record<string, { version?: string }>;
  [key: string]: unknown;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function write(path: string, content: string): void {
  writeFileSync(path, content);
}

function updateJsonVersion(path: string): void {
  const data = JSON.parse(read(path)) as VersionedJson;
  data.version = releaseVersion;
  if (data.packages?.[""]) data.packages[""].version = releaseVersion;
  write(path, `${JSON.stringify(data, null, 2)}\n`);
}

function replace(path: string, pattern: RegExp, replacement: string): void {
  const before = read(path);
  const after = before.replace(pattern, replacement);
  if (after === before) throw new Error(`No version field matched in ${path}`);
  write(path, after);
}

function changelogEntry(): string {
  const bullets = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.startsWith("-") ? line : `- ${line}`)
    .join("\n");
  return `## ${releaseVersion} - ${new Date().toISOString().slice(0, 10)}\n\n${bullets}\n\n`;
}

function updateChangelog(path: string): void {
  const content = read(path);
  const entry = changelogEntry();
  const escaped = releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`(^|\\n)## ${escaped}\\b[^\\n]*\\n+[\\s\\S]*?(?=\\n## |$)`);
  if (heading.test(content)) {
    write(path, content.replace(heading, (_match: string, prefix: string) => `${prefix}${entry.trimEnd()}\n`));
    return;
  }
  write(path, content.replace(/^# Changelog\s*/u, `# Changelog\n\n${entry}`));
}

updateJsonVersion("package.json");
updateJsonVersion("package-lock.json");
updateJsonVersion("frontend/package.json");
updateJsonVersion("frontend/package-lock.json");
replace("pixi.toml", /^version = "[^"]+"/m, `version = "${releaseVersion}"`);
replace("reactive_wire/config.yaml", /^version: "[^"]+"/m, `version: "${releaseVersion}"`);
updateChangelog("reactive_wire/CHANGELOG.md");

console.log(`Prepared release metadata for ${releaseVersion}`);
