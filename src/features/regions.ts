// Frontmatter and fenced code block ranges, cached per doc and carried
// across ordinary edits without rescanning the note.

import type { Text, Transaction } from "@codemirror/state";

const FENCE = /^ {0,3}(```|~~~)/;

/**
 * Frontmatter and fenced code blocks of a doc, as sorted character ranges.
 * Each range runs from the start of the line after the opening line to the
 * end of the closing line (or the end of the doc if it's never closed).
 * Cached per doc: a doc is immutable, and each edit makes a new one.
 */
type Regions = readonly (readonly [number, number])[];
const regionCache = new WeakMap<Text, Regions>();

export function scanRegions(doc: Text): Regions {
  const out: [number, number][] = [];
  let inFront = false;
  let fence: string | null = null;
  let start = 0;
  let pos = 0;
  let n = 0;
  for (const text of doc.iterLines()) {
    n++;
    const lineEnd = pos + text.length;
    if (n === 1 && text === "---") { inFront = true; start = lineEnd + 1; }
    else if (inFront) { if (text === "---" || text === "...") { inFront = false; out.push([start, lineEnd]); } }
    else {
      const m = FENCE.exec(text);
      if (m) {
        if (fence === null) { fence = m[1]; start = lineEnd + 1; }
        else if (m[1] === fence) { fence = null; out.push([start, lineEnd]); }
      }
    }
    pos = lineEnd + 1;
  }
  if (inFront || fence !== null) out.push([start, doc.length]);
  return out;
}

export function regionsOf(doc: Text): Regions {
  let r = regionCache.get(doc);
  if (!r) { r = scanRegions(doc); regionCache.set(doc, r); }
  return r;
}

/** A line that opens or closes a region, or could after this edit. */
const isDelimiter = (text: string): boolean => FENCE.test(text) || text === "---" || text === "...";

/**
 * Work out the new doc's regions from the old doc's, without rescanning, when
 * the edit touches no fence or frontmatter line (the usual keystroke). Lines
 * an edit touches are checked in both the old and the new doc.
 */
export function noteEdit(tr: Transaction): void {
  const newDoc = tr.newDoc;
  if (!tr.docChanged || regionCache.has(newDoc)) return;
  const oldDoc = tr.startState.doc;
  const old = regionCache.get(oldDoc);
  if (!old) return; // scanned lazily, if ever needed
  let structural = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (structural) return;
    for (let n = oldDoc.lineAt(fromA).number, last = oldDoc.lineAt(toA).number; n <= last && !structural; n++) {
      if (n === 1 || isDelimiter(oldDoc.line(n).text)) structural = true;
    }
    for (let n = newDoc.lineAt(fromB).number, last = newDoc.lineAt(toB).number; n <= last && !structural; n++) {
      if (n === 1 || isDelimiter(newDoc.line(n).text)) structural = true;
    }
  });
  if (structural) return;
  // A range can start just past the end (an opening fence on the last line).
  const map = (p: number, assoc: number) => (p > oldDoc.length ? newDoc.length + 1 : tr.changes.mapPos(p, assoc));
  regionCache.set(newDoc, old.map(([from, to]) => [map(from, -1), map(to, 1)] as const));
}

/** True if line n is inside YAML frontmatter or a fenced code block. */
export function inCodeOrFrontmatter(doc: Text, n: number): boolean {
  const pos = doc.line(n).from;
  const r = regionsOf(doc);
  let lo = 0;
  let hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pos < r[mid][0]) hi = mid - 1;
    else if (pos > r[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

