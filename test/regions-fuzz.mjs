// Fuzz test: regions carried across random edits must equal a fresh scan.
// Run: npm run test:regions
import { EditorState } from "@codemirror/state";
import { scanRegions, regionsOf, noteEdit, inCodeOrFrontmatter } from "../.test-build/regions.js";

// The previous line-by-line check, kept as the reference.
const FENCE = /^ {0,3}(```|~~~)/;
function oldInCode(doc, n) {
  let inFront = false, fence = null;
  for (let i = 1; i < n; i++) {
    const text = doc.line(i).text;
    if (i === 1 && text === "---") { inFront = true; continue; }
    if (inFront) { if (text === "---" || text === "...") inFront = false; continue; }
    const m = FENCE.exec(text);
    if (m) { if (fence === null) fence = m[1]; else if (m[1] === fence) fence = null; }
  }
  return inFront || fence !== null;
}

const LINES = ["text", "## Heading", "```", "~~~", "  ```js", "---", "...", "", "more words", "# Title"];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const randomDoc = () => Array.from({ length: 5 + rnd(40) }, () => pick(LINES)).join("\n");
const randomInsert = () => pick(["x", " ", "\n", "#", "`", "```", "\n```\n", "-", "---", ".", "\nword\n", "~~~\n", ""]);

let failures = 0;
for (let round = 0; round < 3000; round++) {
  let state = EditorState.create({ doc: randomDoc() });
  regionsOf(state.doc);
  for (let step = 0; step < 30; step++) {
    const len = state.doc.length;
    const from = rnd(len + 1);
    const to = Math.min(len, from + (Math.random() < 0.7 ? 0 : rnd(12)));
    const tr = state.update({ changes: { from, to, insert: randomInsert() } });
    noteEdit(tr);
    state = tr.state;
    for (let n = 1; n <= state.doc.lines; n++) {
      if (inCodeOrFrontmatter(state.doc, n) !== oldInCode(state.doc, n)) {
        failures++;
        if (failures <= 3) console.log("DIFFERS FROM OLD at line", n, JSON.stringify(state.doc.toString()));
        break;
      }
    }
    const carried = JSON.stringify(regionsOf(state.doc));
    const fresh = JSON.stringify(scanRegions(state.doc));
    if (carried !== fresh) {
      failures++;
      if (failures <= 3) console.log("MISMATCH", JSON.stringify(state.doc.toString()), carried, fresh);
      break;
    }
  }
}
console.log(failures === 0 ? "regions fuzz: PASS (3000 docs x 30 edits)" : `regions fuzz: FAIL (${failures})`);
process.exit(failures ? 1 : 0);
