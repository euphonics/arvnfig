// Locked headings: in opted-in notes, typing can't change an existing heading.
// Instead, starting to change a heading opens Obsidian's "Rename heading" box
// (which also updates links), prefilled with what you typed. Double-clicking a
// heading opens the same box. Moving the cursor through a heading is normal.
//
// What is intercepted: user typing, pasting, cutting, deleting and drag-drop
// (CodeMirror user events "input", "delete", "move") that would change the
// text of an existing heading line or merge it with a neighbouring line.
// What still works: programmatic edits (Rename heading, Templater, other
// plugins, sync, Claude), changing a heading's level (typing or
// deleting #s, or a set-heading hotkey) — which keeps it locked — and writing a
// brand-new heading — a line that just became a heading stays editable until
// the cursor leaves it.
// A multi-line edit that deletes locked headings (select all + Delete, pasting
// over several lines) follows the "deleteMode" setting: ask first (default,
// with a count of links that would break), block, or allow.
// Undo/redo that would change a locked heading is dropped whole (so the undo
// history isn't used up or put out of step) and opens the Rename box instead.

import { Modal, Notice, editorInfoField, type App, type TFile } from "obsidian";
import { findHeadingLinks } from "./renameLinks";
import { inCodeOrFrontmatter, noteEdit } from "./regions";
import { Annotation, EditorState, StateField, Transaction, type Extension, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/** What a multi-line edit that deletes locked headings does (e.g. select all + Delete). */
export type DeleteMode = "ask" | "block" | "allow";
/** What find/replace and other mass edits that change locked headings do. */
export type MassEditMode = "ask" | "block" | "allow";

export interface LockedHeadingsSettings {
  enabled: boolean;
  vaultWide: boolean;
  property: string;
  openRenameOnEdit: boolean;
  showNotice: boolean;
  deleteMode: DeleteMode;
  /** Only lock headings that at least one link points to. */
  linkedOnly: boolean;
  /** Multi-line deletes only follow deleteMode for headings that links point to. */
  deleteLinkedOnly: boolean;
  /** Obsidian's find/replace and the plugins below, when they change locked headings. */
  massEditMode: MassEditMode;
  /** Plugin ids whose edits count as mass edits, comma-separated. */
  massEditPlugins: string;
}

export const DEFAULT_LOCKED_HEADINGS: LockedHeadingsSettings = {
  enabled: true,
  vaultWide: false,
  property: "strict-headings",
  openRenameOnEdit: true,
  showNotice: true,
  deleteMode: "ask",
  linkedOnly: true,
  deleteLinkedOnly: true,
  massEditMode: "ask",
  massEditPlugins: "obsidian-regex-replace, text-finder",
};

/** Marks a deletion the user confirmed, so the filter lets it through. */
const confirmedDelete = Annotation.define<boolean>();

/** Confirm box for a multi-line edit that deletes locked headings. */
class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private headings: string[],
    private links: number,
    private onConfirm: () => void,
    private title?: string,
    private confirmLabel = "Delete",
  ) {
    super(app);
  }

  onOpen(): void {
    const n = this.headings.length;
    this.modalEl.addClass("arvnfig-confirm-delete");
    this.titleEl.setText(this.title ?? `Delete ${n} locked heading${n === 1 ? "" : "s"}?`);
    const list = this.contentEl.createEl("ul");
    for (const h of this.headings.slice(0, 10)) list.createEl("li", { text: h });
    if (n > 10) list.createEl("li", { text: `…and ${n - 10} more` });
    this.contentEl.createEl("p", {
      text: this.links > 0
        ? `${this.links === 1 ? "1 link points" : `${this.links} links point`} to ${n === 1 ? "this heading" : "these headings"} and will break.`
        : `No links point to ${n === 1 ? "this heading" : "these headings"}.`,
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.confirmLabel, cls: "mod-warning" }).addEventListener("click", () => { this.close(); this.onConfirm(); });
    const cancel = buttons.createEl("button", { text: "Cancel", cls: "mod-cancel" });
    cancel.addEventListener("click", () => this.close());
    window.setTimeout(() => cancel.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const HEADING = /^#{1,6}(?:[ \t]|$)/;
const EMPTY_HEADING = /^#{1,6}[ \t]*$/;
const HEADING_PREFIX = /^#{1,6}[ \t]+/;
const FENCE = /^ {0,3}(```|~~~)/;
const BLOCKING_EVENTS = ["input", "delete", "move"];

/** A non-empty ATX heading outside code blocks and frontmatter. */
function isHeadingLine(doc: Text, n: number): boolean {
  const text = doc.line(n).text;
  if (!HEADING.test(text) || EMPTY_HEADING.test(text)) return false;
  return !inCodeOrFrontmatter(doc, n);
}

/** A heading's words, without the #s and the space after them. */
function headingWords(text: string): string {
  return text.replace(HEADING_PREFIX, "");
}

/** Every heading line in the doc, in one pass. */
function allHeadings(doc: Text): HeadingLine[] {
  const out: HeadingLine[] = [];
  let inFront = false;
  let fence: string | null = null;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (i === 1 && text === "---") { inFront = true; continue; }
    if (inFront) { if (text === "---" || text === "...") inFront = false; continue; }
    const m = FENCE.exec(text);
    if (m) {
      if (fence === null) fence = m[1];
      else if (m[1] === fence) fence = null;
      continue;
    }
    if (fence === null && HEADING.test(text) && !EMPTY_HEADING.test(text)) out.push({ from: line.from, to: line.to, text });
  }
  return out;
}

/**
 * Locked headings a mass edit (find/replace) changes or removes. Compares
 * heading words before and after, since some tools replace the whole note.
 */
function massEditHits(tr: Transaction): HeadingLine[] {
  const drafts = tr.startState.field(draftHeadings, false) ?? [];
  const left = new Map<string, number>();
  for (const h of allHeadings(tr.newDoc)) {
    const w = headingWords(h.text);
    left.set(w, (left.get(w) ?? 0) + 1);
  }
  const hits: HeadingLine[] = [];
  for (const h of allHeadings(tr.startState.doc)) {
    if (drafts.includes(h.from)) continue;
    const w = headingWords(h.text);
    const n = left.get(w) ?? 0;
    if (n > 0) left.set(w, n - 1);
    else hits.push(h);
  }
  return hits;
}

/** Start positions of heading lines the user is currently writing (unlocked). */
const draftHeadings = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    noteEdit(tr);
    const doc = tr.state.doc;
    let drafts = tr.docChanged ? value.map((p) => tr.changes.mapPos(p, 1)) : [...value];

    if (tr.docChanged) {
      const inverse = tr.changes.invert(tr.startState.doc);
      const oldDoc = tr.startState.doc;
      tr.changes.iterChangedRanges((_fA, _tA, fromB, toB) => {
        const first = doc.lineAt(fromB).number;
        const last = doc.lineAt(toB).number;
        for (let n = first; n <= last; n++) {
          if (!isHeadingLine(doc, n)) continue;
          const line = doc.line(n);
          // Was this heading already here before the change? A new level
          // (# -> ##, by typing or a hotkey) is still the same heading.
          const oldLine = oldDoc.lineAt(inverse.mapPos(line.from, 1));
          const existed = isHeadingLine(oldDoc, oldLine.number) && headingWords(oldLine.text) === headingWords(line.text);
          if (!existed && !drafts.includes(line.from)) drafts.push(line.from);
        }
      });
    }

    // A draft stays unlocked only while the cursor is on it.
    const headLineFrom = doc.lineAt(tr.state.selection.main.head).from;
    drafts = drafts.filter((p) => p <= doc.length && p === headLineFrom);
    return drafts.length === value.length && drafts.every((p, i) => p === value[i]) ? value : drafts;
  },
});

interface HeadingLine { from: number; to: number; text: string }

/** Existing, locked headings this transaction would change or merge. */
function lockedHeadingsTouched(tr: Transaction): HeadingLine[] {
  const oldDoc = tr.startState.doc;
  const newDoc = tr.newDoc;
  const drafts = tr.startState.field(draftHeadings, false) ?? [];
  const hits: HeadingLine[] = [];

  tr.changes.iterChangedRanges((fromA, toA) => {
    const first = oldDoc.lineAt(Math.max(0, fromA - 1)).number;
    const last = oldDoc.lineAt(Math.min(oldDoc.length, toA + 1)).number;
    for (let n = first; n <= last; n++) {
      if (!isHeadingLine(oldDoc, n)) continue;
      const line = oldDoc.line(n);
      if (drafts.includes(line.from) || hits.some((h) => h.from === line.from)) continue;
      // The heading must survive as the same, whole line.
      const from = tr.changes.mapPos(line.from, 1);
      const to = tr.changes.mapPos(line.to, -1);
      const sameText = to - from === line.length && newDoc.sliceString(from, to) === line.text;
      const atLineStart = from === 0 || newDoc.sliceString(from - 1, from) === "\n";
      const atLineEnd = to === newDoc.length || newDoc.sliceString(to, to + 1) === "\n";
      if (sameText && atLineStart && atLineEnd) continue;
      if (levelChangeOnly(tr, line)) continue;
      hits.push({ from: line.from, to: line.to, text: line.text });
    }
  });
  return hits;
}

/**
 * True if this is a multi-line deletion that removes at least one of the hit
 * headings whole (e.g. select all + Delete, or pasting over several lines).
 * Backspacing a line break into a heading doesn't count.
 */
function deletesHeadings(tr: Transaction, hits: HeadingLine[]): boolean {
  const oldDoc = tr.startState.doc;
  let gone = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (gone || !oldDoc.sliceString(fromA, toA).includes("\n")) return;
    if (hits.some((h) => fromA <= h.from && toA >= h.to)) gone = true;
  });
  return gone;
}

/**
 * True if the edit also changes lines other than this heading's, e.g. Ctrl+B or
 * a paste on a selection that runs from a body line into the heading. The
 * Rename box can't show such an edit. Deleting just the line break next to
 * the heading (merging lines) doesn't count.
 */
function reachesIntoHeading(tr: Transaction, h: HeadingLine): boolean {
  const oldDoc = tr.startState.doc;
  const headingLine = oldDoc.lineAt(h.from).number;
  let otherLines = false;
  let onlyLineBreak = true;
  tr.changes.iterChanges((fromA, toA, _fB, _tB, inserted) => {
    if (oldDoc.lineAt(fromA).number !== headingLine || oldDoc.lineAt(toA).number !== headingLine) otherLines = true;
    if (!(inserted.length === 0 && oldDoc.sliceString(fromA, toA) === "\n")) onlyLineBreak = false;
  });
  return otherLines && !onlyLineBreak;
}

/** How many links in the vault point to these headings of this note. */
function countHeadingLinks(app: App, file: TFile, headings: string[]): number {
  return findHeadingLinks(app, file, headings).length;
}

/**
 * True if the edit only adds or removes #s (or the spaces after them) and the
 * line is still a heading with the same words, e.g. "# Test" -> "## Test".
 */
function levelChangeOnly(tr: Transaction, line: { from: number; to: number; text: string }): boolean {
  const prefix = HEADING_PREFIX.exec(line.text)?.[0];
  if (!prefix) return false;
  const wordsStart = line.from + prefix.length;
  let inPrefix = true;
  tr.changes.iterChanges((fromA, toA, _fB, _tB, inserted) => {
    if (toA < line.from || fromA > line.to) return;
    if (fromA < line.from || toA > wordsStart || inserted.toString().includes("\n")) inPrefix = false;
  });
  if (!inPrefix) return false;
  const newDoc = tr.newDoc;
  const newLine = newDoc.lineAt(tr.changes.mapPos(line.to, -1));
  return isHeadingLine(newDoc, newLine.number) && headingWords(newLine.text) === headingWords(line.text);
}

/**
 * What the Rename box should show: the heading text (without the #s) as it
 * would read after this edit, and where the caret goes. Falls back to the
 * current text when the edit isn't a plain change inside the heading's words.
 */
function renamePrefill(tr: Transaction, h: HeadingLine): { text: string; caret: number } {
  const prefix = HEADING_PREFIX.exec(h.text)?.[0] ?? "";
  const textStart = h.from + prefix.length;
  const current = { text: h.text.slice(prefix.length), caret: h.text.length - prefix.length };
  let inside = true;
  tr.changes.iterChanges((fromA, toA, _fB, _tB, inserted) => {
    if (fromA < textStart || toA > h.to || inserted.toString().includes("\n")) inside = false;
  });
  if (!inside) return current;
  const newLine = tr.newDoc.lineAt(tr.changes.mapPos(h.from, 1));
  if (!newLine.text.startsWith(prefix)) return current;
  const head = tr.newSelection.main.head;
  const caret = Math.max(0, Math.min(newLine.text.length, head - newLine.from) - prefix.length);
  return { text: newLine.text.slice(prefix.length), caret };
}

export function lockedHeadingsExtension(app: App, getSettings: () => LockedHeadingsSettings): Extension {
  let lastNotice = 0;
  // While the Rename box is opening, keystrokes still land in the editor.
  // Collect them so nothing typed in that gap is lost.
  let pending: { headingFrom: number; text: string; caret: number } | null = null;

  const isActive = (state: EditorState): boolean => {
    const s = getSettings();
    if (!s.enabled) return false;
    if (s.vaultWide) return true;
    const file = state.field(editorInfoField, false)?.file;
    if (!file) return false;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const value = fm?.[s.property];
    return value === true || value === "true";
  };

  /** The hits that links point to (the metadata cache reflects the saved note). */
  const linkedHits = (state: EditorState, hits: HeadingLine[]): HeadingLine[] => {
    const file = state.field(editorInfoField, false)?.file;
    if (!file) return [];
    return hits.filter((h) => findHeadingLinks(app, file, [headingWords(h.text)]).length > 0);
  };

  /** Locked headings this edit touches, honoring the "linked only" setting. */
  const lockedHits = (tr: Transaction): HeadingLine[] => {
    const hits = lockedHeadingsTouched(tr);
    if (hits.length === 0 || !getSettings().linkedOnly) return hits;
    return linkedHits(tr.startState, hits);
  };

  /** Headings a multi-line delete should stop for, honoring "deleteLinkedOnly". */
  const deletionHits = (tr: Transaction, hits: HeadingLine[]): HeadingLine[] =>
    getSettings().deleteLinkedOnly && !getSettings().linkedOnly ? linkedHits(tr.startState, hits) : hits;

  /** Which mass-edit tool made this transaction, if any. */
  const massEditSource = (tr: Transaction): string | null => {
    if (tr.isUserEvent("searchReplace")) return "Find and replace";
    if (tr.annotation(Transaction.userEvent) !== undefined) return null;
    const ids = getSettings().massEditPlugins.split(/[\s,]+/).filter(Boolean);
    if (ids.length === 0) return null;
    // Plugins run from scripts named "plugin:<id>", so the call stack shows the caller.
    const E = Error as unknown as { stackTraceLimit: number };
    const limit = E.stackTraceLimit;
    E.stackTraceLimit = 60;
    const stack = new Error().stack ?? "";
    E.stackTraceLimit = limit;
    const id = ids.find((i) => stack.includes(`plugin:${i}:`));
    return id ? ((app as any).plugins?.manifests?.[id]?.name ?? id) : null;
  };

  const notice = (msg: string) => {
    const now = Date.now();
    if (getSettings().showNotice && now - lastNotice > 3000) {
      lastNotice = now;
      new Notice(msg, 2500);
    }
  };

  // Every live editor view, so a blocked edit can find the view it came from.
  const views = new Set<EditorView>();
  // Also wraps each view's dispatch (an own property in CodeMirror), which every
  // undo/redo path ends in: Ctrl+Z / Ctrl+Y keys and Obsidian's editor.undo().
  const viewTracker = ViewPlugin.define((view) => {
    views.add(view);
    const original = view.dispatch;
    const guarded = function (this: unknown, ...args: unknown[]) {
      if (args.some((a) => blocksHistoryStep(a))) return;
      return (original as (...a: unknown[]) => void).apply(view, args);
    };
    (view as { dispatch: unknown }).dispatch = guarded;
    return {
      destroy: () => {
        views.delete(view);
        if ((view as { dispatch: unknown }).dispatch === guarded) (view as { dispatch: unknown }).dispatch = original;
      },
    };
  });

  /** Make the leaf holding this view active, so the command targets it. */
  const activateLeafOf = (view: EditorView) => {
    if ((app.workspace.activeEditor?.editor as any)?.cm === view) return;
    app.workspace.iterateAllLeaves((leaf) => {
      if ((leaf.view as any)?.editor?.cm === view) app.workspace.setActiveLeaf(leaf, { focus: true });
    });
  };

  const modalOpen = () => document.querySelector(".modal-container") !== null;

  /** Put the cursor on the heading and open Rename heading, then prefill it. */
  const openRename = (view: EditorView, headingTo: number) => {
    activateLeafOf(view);
    view.dispatch({ selection: { anchor: headingTo } });
    window.setTimeout(() => {
      (app as any).commands.executeCommandById("editor:rename-heading");
      const started = Date.now();
      const fill = () => {
        const ta = document.querySelector<HTMLTextAreaElement>(".modal.mod-file-rename textarea.rename-textarea");
        if (!ta) {
          if (Date.now() - started < 1000) window.requestAnimationFrame(fill);
          else pending = null;
          return;
        }
        if (pending) {
          ta.value = pending.text;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.focus();
          ta.setSelectionRange(pending.caret, pending.caret);
        }
        pending = null;
      };
      fill();
    }, 0);
  };

  /** A blocked edit: show a notice, or open Rename heading prefilled with the edit. */
  const onBlocked = (tr: Transaction, hits: HeadingLine[]): void => {
    const s = getSettings();
    if (!s.openRenameOnEdit || hits.length > 1) {
      notice(hits.length > 1 ? "That edit would change several locked headings." : "Heading is locked. Double-click it to rename.");
      return;
    }

    const h = hits[0];
    if (reachesIntoHeading(tr, h)) {
      if (!pending) notice("That edit reaches into a locked heading. Select inside the heading or outside it.");
      return;
    }
    if (pending) {
      // Box is still opening: add plain typed text to what it will show.
      if (pending.headingFrom === h.from && tr.isUserEvent("input.type")) {
        let typed = "";
        tr.changes.iterChanges((_fA, _tA, _fB, _tB, ins) => { typed += ins.toString(); });
        if (!typed.includes("\n")) {
          pending.text = pending.text.slice(0, pending.caret) + typed + pending.text.slice(pending.caret);
          pending.caret += typed.length;
        }
      }
      return;
    }
    if (modalOpen()) return;

    const view = [...views].find((v) => v.state === tr.startState);
    if (!view) return;
    const { text, caret } = renamePrefill(tr, h);
    pending = { headingFrom: h.from, text, caret };
    // The filter runs mid-dispatch; open the box once this update finishes.
    window.setTimeout(() => {
      if (view.state.doc !== tr.startState.doc) { pending = null; return; }
      openRename(view, h.to);
    }, 0);
  };

  /**
   * A multi-line edit that deletes locked headings: allow it, block it, or ask
   * first, per the "deleteMode" setting. Returns true if the edit is held back.
   * `proceed` applies the edit if the user confirms.
   */
  const holdDeletion = (tr: Transaction, hits: HeadingLine[], proceed: (view: EditorView) => void): boolean => {
    const mode = getSettings().deleteMode;
    if (mode === "allow") return false;
    if (mode === "block") {
      notice(hits.length > 1 ? "That edit would delete several locked headings." : "That edit would delete a locked heading.");
      return true;
    }
    if (modalOpen()) return true;
    const view = [...views].find((v) => v.state === tr.startState);
    if (!view) return true;
    const file = tr.startState.field(editorInfoField, false)?.file ?? null;
    // The filter runs mid-dispatch; open the box once this update finishes.
    window.setTimeout(() => {
      const links = file ? countHeadingLinks(app, file, hits.map((h) => headingWords(h.text))) : 0;
      new ConfirmDeleteModal(app, hits.map((h) => h.text), links, () => {
        if (view.state.doc !== tr.startState.doc) { new Notice("The note changed, so nothing was deleted."); return; }
        proceed(view);
        view.focus();
      }).open();
    }, 0);
    return true;
  };

  /** A mass edit that changes locked headings: allow, block or ask, per "massEditMode". */
  const holdMassEdit = (tr: Transaction, source: string): boolean => {
    const s = getSettings();
    if (s.massEditMode === "allow") return false;
    let hits = massEditHits(tr);
    if (hits.length > 0 && s.linkedOnly) hits = linkedHits(tr.startState, hits);
    if (hits.length === 0) return false;
    const what = `${hits.length} locked heading${hits.length === 1 ? "" : "s"}`;
    if (s.massEditMode === "block") {
      notice(`${source} would change ${what}. Nothing was replaced.`);
      return true;
    }
    if (modalOpen()) return true;
    const view = [...views].find((v) => v.state === tr.startState);
    if (!view) return true;
    const file = tr.startState.field(editorInfoField, false)?.file ?? null;
    window.setTimeout(() => {
      const links = file ? countHeadingLinks(app, file, hits.map((h) => headingWords(h.text))) : 0;
      new ConfirmDeleteModal(app, hits.map((h) => h.text), links, () => {
        if (view.state.doc !== tr.startState.doc) { new Notice("The note changed, so nothing was replaced."); return; }
        view.dispatch({
          changes: tr.changes,
          userEvent: tr.annotation(Transaction.userEvent),
          annotations: confirmedDelete.of(true),
        });
        view.focus();
      }, `${source} would change ${what}`, "Replace anyway").open();
    }, 0);
    return true;
  };

  const filter = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(confirmedDelete)) return true;
    noteEdit(tr);
    if (!BLOCKING_EVENTS.some((e) => tr.isUserEvent(e))) {
      if (!isActive(tr.startState)) return true;
      const source = massEditSource(tr);
      return source ? !holdMassEdit(tr, source) : true;
    }
    if (!isActive(tr.startState)) return true;
    const hits = lockedHits(tr);
    if (hits.length === 0) return true;
    if (deletesHeadings(tr, hits)) {
      const held = deletionHits(tr, hits);
      if (held.length === 0) return true;
      return !holdDeletion(tr, held, (view) => view.dispatch({
        changes: tr.changes,
        selection: tr.newSelection,
        userEvent: tr.annotation(Transaction.userEvent),
        annotations: confirmedDelete.of(true),
        scrollIntoView: true,
      }));
    }
    onBlocked(tr, hits);
    return false;
  });

  // Undo/redo transactions are built with filters off, so the change filter
  // never sees them. They're caught at dispatch instead (see viewTracker) and
  // dropped whole, so the history entry isn't used up or put out of step.
  // Set while re-running an undo/redo the user confirmed.
  let historyBypass = false;
  const blocksHistoryStep = (tr: unknown): boolean => {
    if (historyBypass) return false;
    if (!(tr instanceof Transaction) || !tr.docChanged) return false;
    noteEdit(tr);
    const isUndo = tr.isUserEvent("undo");
    if (!isUndo && !tr.isUserEvent("redo")) return false;
    if (!isActive(tr.startState)) return false;
    const hits = lockedHits(tr);
    if (hits.length === 0) return false;
    if (deletesHeadings(tr, hits)) {
      const held = deletionHits(tr, hits);
      if (held.length === 0) return false;
      // On confirm, run the undo/redo again: the held transaction may be stale
      // by then (the editor's state changes when the dialog takes focus).
      return holdDeletion(tr, held, (view) => {
        let editor: { undo(): void; redo(): void } | null = null;
        app.workspace.iterateAllLeaves((leaf) => {
          const e = (leaf.view as any)?.editor;
          if (e?.cm === view) editor = e;
        });
        if (!editor) return;
        historyBypass = true;
        try { isUndo ? (editor as { undo(): void }).undo() : (editor as { redo(): void }).redo(); }
        finally { historyBypass = false; }
      });
    }
    onBlocked(tr, hits);
    return true;
  };

  const dblclick = EditorView.domEventHandlers({
    dblclick(event, view) {
      if (!isActive(view.state)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const line = view.state.doc.lineAt(pos);
      if (!isHeadingLine(view.state.doc, line.number)) return false;
      const h = { from: line.from, to: line.to, text: line.text };
      if (getSettings().linkedOnly && linkedHits(view.state, [h]).length === 0) return false;
      event.preventDefault();
      pending = null;
      openRename(view, line.to);
      return true;
    },
  });

  return [draftHeadings, viewTracker, filter, dblclick];
}
