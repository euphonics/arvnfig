// Heading-path link suggestions: after [[# or [[Note#, typing words from a
// heading's parent headings and then the heading itself, in order, finds it.
// E.g. under "# Act 1" > "## Part 2" > "### My heading 3", typing
// [[#act 1 part 2 heading 3 suggests "My heading 3". Each typed word must
// start a word of the path, in the same order; words can be skipped.

import {
  EditorSuggest,
  type App,
  type Editor,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
  type HeadingCache,
  type Plugin,
  type TFile,
} from "obsidian";

interface PathSuggestion {
  heading: string;
  level: number;
  /** Parent headings, outermost first. */
  parents: string[];
  /** Link path to the note ("" for the current note). */
  linkpath: string;
  /** The heading text appears more than once in the note. */
  duplicate: boolean;
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Each query word starts a path word, in order. */
function matchesInOrder(query: string[], path: string[]): boolean {
  let i = 0;
  for (const w of path) {
    if (i < query.length && w.startsWith(query[i])) i++;
  }
  return i === query.length;
}

/** Characters Obsidian doesn't allow in a heading link. */
const linkSafe = (s: string): string => s.replace(/[#|^[\]]/g, " ").replace(/\s+/g, " ").trim();

function pathsOf(headings: HeadingCache[], linkpath: string): PathSuggestion[] {
  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h.heading, (counts.get(h.heading) ?? 0) + 1);
  const stack: HeadingCache[] = [];
  const out: PathSuggestion[] = [];
  for (const h of headings) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    out.push({
      heading: h.heading,
      level: h.level,
      parents: stack.map((p) => p.heading),
      linkpath,
      duplicate: (counts.get(h.heading) ?? 0) > 1,
    });
    stack.push(h);
  }
  return out;
}

class HeadingPathSuggest extends EditorSuggest<PathSuggestion> {
  private target: { file: TFile; linkpath: string } | null = null;

  constructor(app: App, private enabled: () => boolean) {
    super(app);
    this.limit = 50;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.enabled() || !file) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const open = before.lastIndexOf("[[");
    if (open < 0) return null;
    const inside = before.slice(open + 2);
    if (/\]\]|\|/.test(inside)) return null;
    const hash = inside.indexOf("#");
    if (hash < 0 || inside[hash + 1] === "^") return null;
    const linkpath = inside.slice(0, hash);
    const query = inside.slice(hash + 1);
    // Plain one-word searches are left to Obsidian's own suggestions.
    if (words(query).length < 2) return null;
    const dest = linkpath === "" ? file : this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
    if (!dest) return null;
    this.target = { file: dest, linkpath };
    // No match: let Obsidian's own (fuzzy) suggestions take over.
    if (this.find(query).length === 0) return null;
    return { start: { line: cursor.line, ch: open + 2 }, end: cursor, query };
  }

  getSuggestions(ctx: EditorSuggestContext): PathSuggestion[] {
    return this.find(ctx.query);
  }

  private find(query: string): PathSuggestion[] {
    if (!this.target) return [];
    const headings = this.app.metadataCache.getFileCache(this.target.file)?.headings ?? [];
    const q = words(query);
    return pathsOf(headings, this.target.linkpath).filter((p) => matchesInOrder(q, words([...p.parents, p.heading].join(" "))));
  }

  renderSuggestion(p: PathSuggestion, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: p.heading });
    if (p.parents.length) content.createDiv({ cls: "suggestion-note", text: p.parents.join(" › ") });
    el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair", text: `H${p.level}` });
  }

  selectSuggestion(p: PathSuggestion): void {
    const ctx = this.context;
    if (!ctx) return;
    const { editor, start, end } = ctx;
    // A heading name used more than once gets its full path, so the link is unambiguous.
    const sub = (p.duplicate ? [...p.parents, p.heading] : [p.heading]).map(linkSafe).join("#");
    const text = `${p.linkpath}#${sub}`;
    const hasClose = editor.getRange(end, { line: end.line, ch: end.ch + 2 }) === "]]";
    editor.replaceRange(hasClose ? text : `${text}]]`, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length + 2 });
  }
}

/** Register the suggester ahead of Obsidian's own link suggestions. */
export function registerHeadingPathSuggest(plugin: Plugin, enabled: () => boolean): void {
  const suggest = new HeadingPathSuggest(plugin.app, enabled);
  plugin.registerEditorSuggest(suggest);
  const list = (plugin.app.workspace as any).editorSuggest?.suggests as unknown[] | undefined;
  if (list && list[0] !== suggest) {
    const i = list.indexOf(suggest);
    if (i > 0) { list.splice(i, 1); list.unshift(suggest); }
  }
}
