// Publish a GitHub release that BRAT can install from.
// Usage: npm run release -- 0.1.1   (omit the version to release the current one)
// Sets the version in manifest.json, builds, commits, tags and creates the
// release with main.js and manifest.json attached. The Notes vault picks it up
// through BRAT ("Check for updates", or at Obsidian startup).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = process.argv[2] ?? manifest.version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`Bad version: ${version}`);

if (execSync("git status --porcelain").toString().trim()) throw new Error("Commit or stash your changes first.");

if (version !== manifest.version) {
  manifest.version = version;
  writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  run("git add manifest.json");
  run(`git commit -m "Release ${version}"`);
}

run("node esbuild.config.mjs");
run(`git tag ${version}`);
run("git push");
run(`git push origin ${version}`);
run(`gh release create ${version} main.js manifest.json --title "Arvnfig ${version}" --notes "Install or update with BRAT: euphonics/arvnfig"`);
