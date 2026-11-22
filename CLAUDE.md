# Arvnfig: agent instructions

Personal Obsidian plugin (id `arvnfig`). Feature reference lives in the
Notes vault note `Tech/Obsidian/Arvnfig Plugin — Setup Documentation.md`;
the wish list in `Arvnfig wishlist.md`.

## Pipeline (same for all of the author's Obsidian plugins)

1. **Develop** here, in `C:\Users\arunc\Code\arvnfig`.
2. **Test in the Dev vault** (`C:\Users\arunc\Code\Obsidian Dev Vault\Dev`,
   CLI `obsidian vault=Dev`): `npm run install-vault`, then
   `obsidian vault=Dev eval code="eval(require('fs').readFileSync('C:/Users/arunc/Code/arvnfig/test/obsidian-tests.js','utf8'))"`.
   Never test in the Notes vault.
3. **When confident** (tests pass in Dev), do both, without asking:
   `npm run install-notes` (copies the build into the Notes vault, where the
   author verifies it) and commit + push to GitHub.
4. **Release only on the author's explicit approval:**
   `npm run release -- x.y.z`. Releases are for other people who install
   with BRAT; the version goes up only here. One release per verified batch,
   never one per push. The Notes vault does not get Arvnfig through BRAT.

## Checks

- `npx tsc --noEmit -p .` before committing.
- The test suite uses `Strict Heading Test.md` in the Dev vault and restores
  its content (`strict-headings: true`, `## Test`) and all Arvnfig settings.
- Editor commands only work in the focused window; the suite focuses the Dev
  window first, since Notes is usually open too.

## Rules

- Run `obsidian` commands from PowerShell, not Bash.
- Never call another plugin's prototype methods in probes (it can run their
  onload/onunload).
- New features go in `src/features/<name>.ts` with their own settings
  section in `src/main.ts`.
