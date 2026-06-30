#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = listFiles();
const banned = [
  { token: ["ERC", "8183"].join("-"), message: "out-of-scope ERC reference" },
  { token: ["ERC", "8275"].join("-"), message: "out-of-scope ERC reference" }
];
let failed = false;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (/\t/u.test(text)) {
    console.error(`lint failed: tab character in ${file}`);
    failed = true;
  }
  if (new RegExp(["console", "debug"].join("\\."), "u").test(text)) {
    console.error(`lint failed: debug console call in ${file}`);
    failed = true;
  }
  for (const rule of banned) {
    if (file.includes("README.md") || file.includes("threat-model.md")) {
      continue;
    }
    if (text.includes(rule.token)) {
      console.error(`lint failed: ${rule.message} in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

function listFiles() {
  const result = spawnSync("find", ["src", "test", "bin", "scripts", "docs", "-type", "f"], {
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
