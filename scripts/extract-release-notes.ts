#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [version, outPath] = process.argv.slice(2);
if (!version || !outPath) {
  console.error("Usage: npx tsx scripts/extract-release-notes.ts <version> <output-file>");
  process.exit(1);
}

const changelog = readFileSync("reactive_wire/CHANGELOG.md", "utf8");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = changelog.match(new RegExp(`(?:^|\\n)## ${escaped}[^\\n]*\\n+([\\s\\S]*?)(?=\\n## |$)`));
const notes = match?.[1]?.trim() || `Reactive Wire ${version}`;
writeFileSync(outPath, `${notes}\n`);
