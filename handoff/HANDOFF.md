# Arvnfig handoff (from the XPS session, 2026-11-21)

Short version of where things stand. The full conversation is in `2026-11-21 XPS session export.zip` next to this file. Read the zip only when you need detail that isn't here.

## What Arvnfig is

- The user's own Obsidian plugin for their personal editor preferences, one feature at a time.
- Plugin id `arvnfig`, display name "Arvnfig".
- It was first built as "Arvn's House Rules" (`arvn-house-rules`) and renamed the same day. The old installed folder is in the vault's `.trash/arvn-house-rules-plugin-old`.
- Source: `C:\Users\arunc\Code\arvnfig` (TypeScript + esbuild). Git repo, remote github.com/euphonics/arvnfig (private).
  - `src/main.ts`: entry point, settings tab, the toggle command
  - `src/features/lockedHeadings.ts`: the locked-headings feature
  - `test/obsidian-tests.js`: test suite, run inside Obsidian with `obsidian eval`
  - `node_modules/` is marked Dropbox-ignored. If it's missing on this computer, run `npm install` in the source folder.
- Installed copy: `Dropbox/Notes/.obsidian/plugins/arvnfig/` (`main.js` + `manifest.json`).
- Docs note in the vault: `Tech/Obsidian/Arvnfig Plugin — Setup Documentation.md`

## Feature 1: Locked headings (done, 15/15 tests passing on the XPS)

- Applies to notes with `strict-headings: true`, or every note if "Apply to the whole vault" is on in settings.
- Command palette: **Arvnfig: Toggle strict headings in current note** adds or removes the property.
- Moving the cursor through a heading is normal.
- Typing, deleting, cutting or pasting in an existing heading doesn't change it. Instead, Obsidian's Rename heading box (`editor:rename-heading`) opens, prefilled with the edit and the caret placed right after it. Keys typed while the box opens are added too.
- A blocked edit that can't be shown in the box (merging the next line, typing before the `#`) opens the box with the current text.
- An edit spanning several headings is just blocked, with a notice.
- Allowed: Enter at the start or end of a heading, double-click (opens Rename heading), programmatic edits (Rename heading, Templater, other plugins, sync).
- A heading the user is still writing stays editable until the cursor leaves its line.
- Changing only the level (typing/deleting `#`, or `editor:set-heading-N` hotkeys like Ctrl+Alt+2) is allowed with no box, and the heading stays locked (added on tvf, 2026-11-21).
- Undo/redo that would change a locked heading's words is blocked and opens Rename heading. CodeMirror builds history transactions with filters off, so the change filter can't see them. Instead the `ViewPlugin` wraps each view's `dispatch` (an own property) and drops the whole transaction, which leaves the undo history intact. Undo/redo of a level change is allowed.
- Setting `deleteMode` ("ask" default / "block" / "allow") covers multi-line deletes that remove a locked heading whole (`deletesHeadings`), including undo/redo. "ask" opens `ConfirmDeleteModal` with the headings and a count of links to them (`countHeadingLinks`, from `metadataCache`). A confirmed edit is re-sent with the `confirmedDelete` annotation; a confirmed undo/redo is re-run with `historyBypass` set. A "rename each heading" mode was considered and rejected, because renaming can't save links to a deleted heading.
- Ctrl+B (`editor:toggle-bold`) counts as an "input" event, so it's locked like typing. Inside one heading it opens Rename with e.g. `**Some** Heading`. An edit that also changes other lines (`reachesIntoHeading`, e.g. bold or paste from a body line into a heading) gives a notice and no box. Backspacing a line break into a heading is the exception and still opens the box.
- Settings `linkedOnly` (only lock headings with links pointing to them; also gates double-click) and `deleteLinkedOnly` (multi-line deletes only hold for linked headings). Both use `findHeadingLinks` from `renameLinks.ts`, i.e. the metadata cache of the saved note.
- Find/replace guard: `massEditMode` (ask/block/allow) and `massEditPlugins` (plugin ids). Obsidian's find/replace dispatches with userEvent `searchReplace`. Plugins send no userEvent; Regex Find/Replace uses `editor.setValue` (whole note), Text Finder dispatches a raw change set. Both are spotted by the call stack, since plugin code runs from scripts named `plugin:<id>` (stackTraceLimit raised to 60 while checking). `massEditHits` compares heading words before/after (one-pass `allHeadings`), not positions.
- Feature 3 `src/features/headingPathSuggest.ts`: `EditorSuggest` for `[[#`/`[[Note#` with 2+ words, matched in order by word prefix; moved to the front of `app.workspace.editorSuggest.suggests`; returns null when nothing matches so Obsidian's suggester takes over. Setting `headingPathSuggest` (top level).
- Suite: 53 tests, all passing on tvf. The suite snapshots all lockedHeadings settings, forces `vaultWide`/`linkedOnly`/`deleteLinkedOnly` off, and restores them at the end (the user has vault-wide on). Test gotcha: Obsidian moves a cursor at position 0 out of the frontmatter onto the first body line, which makes a new heading there count as still being written.
- Settings: enable, whole vault, property name, "Open Rename heading when you type in a heading", show notices.

## How it works

- `EditorState.changeFilter`: only intercepts user events "input", "delete" and "move" in active notes. It compares each existing heading line before and after the edit.
- A `StateField` tracks headings being written ("drafts"), which stay unlocked while the cursor is on them.
- A `ViewPlugin` tracks editor views, so a blocked edit opens the box in the editor it came from. Before running the command it makes that leaf active.
- The Rename box is `.modal.mod-file-rename textarea.rename-textarea`. The plugin fills it after the command opens it.

## Build, install, test

1. In the source folder, run `npm run install-vault`. It builds and copies `main.js` + `manifest.json` into the vault plugin folder. Note: `esbuild.config.mjs` hardcodes `C:/Users/arunc/Dropbox/Notes/.obsidian/plugins/arvnfig`.
2. Reload: `obsidian eval code="app.plugins.disablePlugin('arvnfig').then(()=>app.plugins.enablePlugin('arvnfig'))"` (run `obsidian` commands from PowerShell, not Bash).
3. Test: `obsidian eval code="eval(require('fs').readFileSync('<full path to test/obsidian-tests.js, forward slashes>','utf8'))"`. It uses the vault note `Strict Heading Test.md`, which should be empty before and after. Expect 15 PASS lines.

## Gotchas

- Hot Reload only watches plugin folders containing `.hotreload`. `npm run install-vault` now creates it in the arvnfig folder, so installs reload Obsidian on both computers. If a change doesn't show, append a comment line to the installed `main.js` to force a fresh sync.

- The tests drive the live Obsidian window and focus. Keystrokes from someone using the same computer leak into the test note. That's why testing moved to tvf.
- The user also has a separate **Scribidian** session on tvf. Keep that session for Scribidian work only; don't use it for Arvnfig.
- The Text Format plugin's title case (`Ctrl + 2`) goes through a Templater template (`_template/_Obsidian/_title case line.md`). That's a programmatic edit, so it can change locked headings. This is on purpose.
- Vault rules live in `Dropbox/Notes/CLAUDE.md`. Log vault changes in `CLAUDE changelog.md`.

## Open / next

- Wishlist lives in the vault note `Arvnfig wishlist.md`. Open item: `[[` suggestions inside the Rename box (on hold; `metadataCache.getLinkSuggestions()` could make it cheap).

- Nothing pending for feature 1. The user hasn't done a hands-on check with real typing yet.
- Future features go in `src/features/<name>.ts`. Register each in `main.ts` with its own settings section. One idea already raised: cycling task status `[ ]` → `[x]` → `[-]` with Alt+Shift+[. The Tasks plugin can already do that through settings, so it isn't needed in Arvnfig unless the user asks.
