# Arvnfig

Personal Obsidian plugin (id `arvnfig`).

- Locked headings: renaming a heading that links point to opens Obsidian's rename box, deleting one asks first, find and replace that would change locked headings asks, blocks or allows.
- Close tabs to the right / left: two commands (assign hotkeys in Obsidian) that close the tabs beside the active one in its own tab group only. Pinned tabs stay.
- Heading-path link suggestions: after `[[#` or `[[Note#`, type words from parent headings then the heading, in order.

## Build

```
npm install
npm run build          # main.js
npm run install-vault  # build and copy into the dev vault
npm run install-notes  # build and copy into the main Notes vault
npm run release -- 0.1.1  # tag and publish a GitHub release (for BRAT users)
```

## Install with BRAT

In Obsidian, install BRAT, then **BRAT: Add a beta plugin for testing** and enter `euphonics/arvnfig`.

Tests run inside Obsidian: see `test/obsidian-tests.js`.
