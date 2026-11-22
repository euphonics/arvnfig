import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --install: the dev vault (all dev work and tests). --install-notes: the main Notes vault (release).
const VAULTS = {
  dev: "C:/Users/arunc/Code/Obsidian Dev Vault/Dev",
  notes: "C:/Users/arunc/Dropbox/Notes",
};

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
});

const target = process.argv.includes("--install-notes") ? "notes" : process.argv.includes("--install") ? "dev" : null;
if (target) {
  const VAULT_PLUGIN_DIR = `${VAULTS[target]}/.obsidian/plugins/arvnfig`;
  mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
  // The Hot Reload plugin only watches plugin folders that contain .hotreload.
  const marker = join(VAULT_PLUGIN_DIR, ".hotreload");
  if (!existsSync(marker)) writeFileSync(marker, "");
  for (const f of ["main.js", "manifest.json"]) copyFileSync(f, join(VAULT_PLUGIN_DIR, f));
  console.log(`Installed to ${VAULT_PLUGIN_DIR}`);
}
