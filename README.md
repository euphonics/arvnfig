# Arvnfig

Personal Obsidian plugin (id `arvnfig`).

- Locked headings: renaming a heading that links point to opens Obsidian's rename box, deleting one asks first, find and replace that would change locked headings asks, blocks or allows.
- Heading-path link suggestions: after `[[#` or `[[Note#`, type words from parent headings then the heading, in order.

## Build

```
npm install
npm run build          # main.js
npm run install-vault  # build and copy into the dev vault
npm run install-notes  # build and copy into the main Notes vault
```

Tests run inside Obsidian: see `test/obsidian-tests.js`.
