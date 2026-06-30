#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const write = process.argv.includes("--write");
const files = listFiles();
let failed = false;

for (const file of files) {
  const original = readFileSync(file, "utf8");
  const formatted = `${original.replace(/[ \t]+$/gm, "").replace(/\n*$/u, "")}\n`;
  if (formatted !== original) {
    if (write) {
      writeFileSync(file, formatted);
    } else {
      console.error(`format check failed: ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

function listFiles() {
  const result = spawnSync("find", ["src", "test", "bin", "scripts", "docs", ".github", "-type", "f"], {
    cwd: join(import.meta.dirname, ".."),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((file) => join(import.meta.dirname, "..", file));
}
