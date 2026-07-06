#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const notes = (process.env.RELEASE_NOTES ?? process.argv.slice(3).join(" ")).trim() || `Release ${version}.`;

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/prepare-release.mjs <semver> [notes]");
  process.exit(1);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
}

function updateJsonVersion(path) {
  const data = JSON.parse(read(path));
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  write(path, `${JSON.stringify(data, null, 2)}\n`);
}

function replace(path, pattern, replacement) {
  const before = read(path);
  const after = before.replace(pattern, replacement);
  if (after === before) throw new Error(`No version field matched in ${path}`);
  write(path, after);
}

function changelogEntry() {
  const bullets = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.startsWith("-") ? line : `- ${line}`)
    .join("\n");
  return `## ${version} - ${new Date().toISOString().slice(0, 10)}\n\n${bullets}\n\n`;
}

function updateChangelog(path) {
  const content = read(path);
  const entry = changelogEntry();
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`(^|\\n)## ${escaped}\\b[^\\n]*\\n+[\\s\\S]*?(?=\\n## |$)`);
  if (heading.test(content)) {
    write(path, content.replace(heading, (_match, prefix) => `${prefix}${entry.trimEnd()}\n`));
    return;
  }
  write(path, content.replace(/^# Changelog\s*/u, `# Changelog\n\n${entry}`));
}

updateJsonVersion("package.json");
updateJsonVersion("package-lock.json");
updateJsonVersion("frontend/package.json");
updateJsonVersion("frontend/package-lock.json");
replace("pixi.toml", /^version = "[^"]+"/m, `version = "${version}"`);
replace("reactive_wire/config.yaml", /^version: "[^"]+"/m, `version: "${version}"`);
updateChangelog("reactive_wire/CHANGELOG.md");

console.log(`Prepared release metadata for ${version}`);
