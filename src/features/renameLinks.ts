// Links in the Rename heading box: when Obsidian's Rename heading box opens
// (from the command palette, a hotkey, a double-click or a locked heading),
// a list below the text box shows every link that points to the heading,
// with the note it's in and the line around it. Rename heading updates
// those links; the list shows what will change. Clicking one closes the box
// and opens that note at the link.

import { parseLinktext, type App, type Plugin, type TFile } from "obsidian";

export interface HeadingLink {
  source: TFile;
  /** 0-based line of the link in the source note. */
  line: number;
  /** The link as written, e.g. "[[Note#Heading|shown text]]". */
  original: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Every link and embed in the vault that points to one of these headings of `file`. */
export function findHeadingLinks(app: App, file: TFile, headings: string[]): HeadingLink[] {
  const wanted = new Set(headings.map(norm));
  const found: HeadingLink[] = [];
  for (const [sourcePath, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
    if (!dests[file.path] && sourcePath !== file.path) continue;
    const source = app.vault.getFileByPath(sourcePath);
    if (!source) continue;
    const cache = app.metadataCache.getCache(sourcePath);
    for (const ref of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
      const { path, subpath } = parseLinktext(ref.link);
      if (!subpath || subpath.startsWith("#^")) continue;
      const toThis = path === "" ? sourcePath === file.path : app.metadataCache.getFirstLinkpathDest(path, sourcePath) === file;
      if (!toThis) continue;
      const last = subpath.split("#").filter(Boolean).pop() ?? "";
      if (wanted.has(norm(last))) found.push({ source, line: ref.position.start.line, original: ref.original });
    }
  }
  return found.sort((a, b) => a.source.path.localeCompare(b.source.path) || a.line - b.line);
}

const MAX_SHOWN = 100;

/** Fill `container` with the list of links (async: reads the lines around them). */
async function renderLinks(app: App, container: HTMLElement, links: HeadingLink[], close: () => void): Promise<void> {
  container.createDiv({
    cls: "arvnfig-heading-links-title",
    text: links.length === 0
      ? "No links point to this heading."
      : `${links.length === 1 ? "1 link points" : `${links.length} links point`} to this heading and will be updated:`,
  }).setCssStyles({ margin: "12px 0 6px", color: "var(--text-muted)", fontSize: "var(--font-ui-small)" });
  if (links.length === 0) return;

  const list = container.createEl("ul", { cls: "arvnfig-heading-links-list" });
  list.setCssStyles({ maxHeight: "220px", overflowY: "auto", margin: "0", paddingLeft: "1.2em", fontSize: "var(--font-ui-small)" });
  const texts = new Map<string, string[]>();
  for (const link of links.slice(0, MAX_SHOWN)) {
    let lines = texts.get(link.source.path);
    if (!lines) {
      lines = (await app.vault.cachedRead(link.source)).split("\n");
      texts.set(link.source.path, lines);
    }
    const lineText = (lines[link.line] ?? link.original).trim();
    const item = list.createEl("li");
    item.setCssStyles({ cursor: "pointer", margin: "2px 0" });
    item.createSpan({ text: link.source.basename, cls: "arvnfig-heading-links-note" }).setCssStyles({ fontWeight: "600" });
    item.createSpan({ text: ` (line ${link.line + 1}): ` }).setCssStyles({ color: "var(--text-faint)" });
    item.createSpan({ text: lineText.length > 140 ? `${lineText.slice(0, 140)}…` : lineText });
    item.setAttr("title", `Open ${link.source.path} at line ${link.line + 1}`);
    item.addEventListener("click", () => {
      close();
      void app.workspace.getLeaf("tab").openFile(link.source, { eState: { line: link.line } });
    });
  }
  if (links.length > MAX_SHOWN) list.createEl("li", { text: `…and ${links.length - MAX_SHOWN} more` });
}

/**
 * Watch for the Rename heading command and add the link list to its box.
 * `enabled` is checked each time, so the setting applies at once.
 */
export function registerRenameLinks(plugin: Plugin, enabled: () => boolean): void {
  const app = plugin.app;
  const commands = (app as any).commands as { executeCommand: (command: { id: string }, ...rest: unknown[]) => boolean };
  const original = commands.executeCommand;

  const wrapped = function (this: unknown, command: { id: string }, ...rest: unknown[]) {
    const heading = command?.id === "editor:rename-heading" && enabled() ? currentHeading(app) : null;
    const result = original.call(this, command, ...rest);
    if (heading) addListWhenOpen(app, heading.file, heading.words);
    return result;
  };
  commands.executeCommand = wrapped;
  plugin.register(() => {
    if (commands.executeCommand === wrapped) commands.executeCommand = original;
  });
}

/** The heading under the cursor in the active editor, if any. */
function currentHeading(app: App): { file: TFile; words: string } | null {
  const editor = app.workspace.activeEditor?.editor;
  const file = app.workspace.activeEditor?.file ?? null;
  if (!editor || !file) return null;
  const text = editor.getLine(editor.getCursor().line);
  const m = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(text);
  return m ? { file, words: m[1] } : null;
}

/** Wait (up to 1 s) for the Rename heading box, then add the list to it. */
function addListWhenOpen(app: App, file: TFile, words: string): void {
  const started = Date.now();
  const tick = () => {
    const modal = document.querySelector<HTMLElement>(".modal.mod-file-rename");
    if (!modal) {
      if (Date.now() - started < 1000) window.requestAnimationFrame(tick);
      return;
    }
    if (modal.querySelector(".arvnfig-heading-links")) return;
    const content = modal.querySelector<HTMLElement>(".modal-content") ?? modal;
    const container = content.createDiv({ cls: "arvnfig-heading-links" });
    // The box has no close button, only Save and Cancel.
    const close = () =>
      (modal.querySelector<HTMLElement>(".mod-cancel") ?? modal.querySelector<HTMLElement>(".modal-close-button"))?.click();
    void renderLinks(app, container, findHeadingLinks(app, file, [words]), close);
  };
  tick();
}
