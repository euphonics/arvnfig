import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VAULT_PLUGIN_DIR = "C:/Users/arunc/Dropbox/Notes/.obsidian/plugins/arvnfig";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
});

if (process.argv.includes("--install")) {
  mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
  // The Hot Reload plugin only watches plugin folders that contain .hotreload.
  const marker = join(VAULT_PLUGIN_DIR, ".hotreload");
  if (!existsSync(marker)) writeFileSync(marker, "");
  for (const f of ["main.js", "manifest.json"]) copyFileSync(f, join(VAULT_PLUGIN_DIR, f));
  console.log(`Installed to ${VAULT_PLUGIN_DIR}`);
}
