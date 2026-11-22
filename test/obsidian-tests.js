(async () => {
  const out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const closeModals = async () => { document.querySelectorAll(".modal-container .mod-cancel").forEach((b) => b.click()); await wait(150); };
  const modalText = () => document.querySelector(".modal.mod-file-rename textarea.rename-textarea");
  // Editor commands (Rename heading) only work in the focused window. With two
  // vaults open, bring this one to the front first.
  const win = require("electron").remote?.getCurrentWindow?.();
  if (win) { win.show(); win.focus(); } else window.focus();
  await wait(300);
  await closeModals();
  await app.plugins.disablePlugin("arvnfig");
  await app.plugins.enablePlugin("arvnfig");

  const body = "---\nstrict-headings: true\n---\nintro\n## Some Heading\nbody line\n\n```\n# not a heading\n```\n";
  const f = app.vault.getAbstractFileByPath("Strict Heading Test.md");
  const original = await app.vault.read(f);
  await app.vault.modify(f, body);
  let leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view.file === f);
  const opened = !leaf;
  if (!leaf) { leaf = app.workspace.getLeaf("tab"); await leaf.openFile(f, { state: { mode: "source" } }); }
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await wait(700);
  const cm = leaf.view.editor.cm;
  for (let i = 0; i < 30 && cm.state.doc.toString() !== body; i++) await wait(100);
  if (cm.state.doc.toString() !== body) { await app.vault.modify(f, original); return "editor never loaded test content"; }
  const doc = () => cm.state.doc.toString();
  const lineOf = (t) => { for (let i = 1; i <= cm.state.doc.lines; i++) if (cm.state.doc.line(i).text === t) return cm.state.doc.line(i); };
  const ok = (c, name) => out.push(`${c ? "PASS" : "FAIL"} ${name}`);
  const savedSettings = { ...app.plugins.plugins.arvnfig.settings.lockedHeadings };
  Object.assign(app.plugins.plugins.arvnfig.settings.lockedHeadings, { vaultWide: false, linkedOnly: false, deleteLinkedOnly: false, openRenameOnEdit: true });

  try {
  // 1. Moving the cursor through a heading is normal
  let h = lineOf("## Some Heading");
  cm.dispatch({ selection: { anchor: h.from + 5 } });
  await wait(200);
  ok(!modalText() && cm.state.selection.main.head === h.from + 5, "cursor moves into heading, no box");

  // 2. Typing opens Rename heading prefilled with the edit
  let before = doc();
  cm.dispatch({ changes: { from: h.from + 8, insert: "x" }, selection: { anchor: h.from + 9 }, userEvent: "input.type" });
  await wait(500);
  let ta = modalText();
  ok(doc() === before, "typed char not written to note");
  ok(ta && ta.value === "Some xHeading", `box prefilled: ${ta && JSON.stringify(ta.value)}`);
  ok(ta && ta.selectionStart === 6, `caret after typed char: ${ta && ta.selectionStart}`);
  await closeModals();

  // 3. Fast typing while the box opens keeps every character
  h = lineOf("## Some Heading");
  cm.dispatch({ changes: { from: h.to, insert: "a" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
  cm.dispatch({ changes: { from: h.to, insert: "b" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
  cm.dispatch({ changes: { from: h.to, insert: "c" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
  await wait(500);
  ta = modalText();
  ok(ta && ta.value === "Some Headingabc", `fast typing captured: ${ta && JSON.stringify(ta.value)}`);
  await closeModals();

  // 4. Backspace that merges the next line opens the box with the current text
  h = lineOf("## Some Heading");
  cm.dispatch({ changes: { from: h.to, to: h.to + 1 }, userEvent: "delete.backward" });
  await wait(500);
  ta = modalText();
  ok(doc() === before && ta && ta.value === "Some Heading", `merge blocked, box shows current text: ${ta && JSON.stringify(ta.value)}`);
  await closeModals();

  // 5. Enter at end of heading still makes a new line, no box
  h = lineOf("## Some Heading");
  cm.dispatch({ changes: { from: h.to, insert: "\n" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
  await wait(300);
  ok(doc() !== before && !modalText(), "Enter at end of heading allowed, no box");
  cm.dispatch({ changes: { from: h.to, to: h.to + 1 } });

  // 6. Full rename through the box
  h = lineOf("## Some Heading");
  cm.dispatch({ selection: { anchor: 0 } });
  cm.dispatch({ changes: { from: h.to - 7, to: h.to }, userEvent: "delete.cut" });
  await wait(500);
  ta = modalText();
  ok(ta && ta.value === "Some ", `cut prefilled: ${ta && JSON.stringify(ta.value)}`);
  if (ta) { ta.value = "Renamed Heading"; ta.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector(".modal.mod-file-rename button.mod-cta").click(); }
  await wait(800);
  ok(!!lineOf("## Renamed Heading"), "Save renames the heading");

  // 7. Double-click opens the box
  h = lineOf("## Renamed Heading");
  const c = cm.coordsAtPos(h.from + 6);
  cm.contentDOM.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: c.left + 1, clientY: (c.top + c.bottom) / 2 }));
  await wait(500);
  ta = modalText();
  ok(ta && ta.value === "Renamed Heading", "double-click opens box");
  await closeModals();

  // 8. Code block # line edits normally
  const cb = lineOf("# not a heading");
  cm.dispatch({ changes: { from: cb.to, insert: "!" }, userEvent: "input.type" });
  await wait(300);
  ok(!!lineOf("# not a heading!") && !modalText(), "code-block # line editable");

  // 9. Toggle command off -> typing edits heading directly
  cm.dispatch({ selection: { anchor: 0 } });
  app.commands.executeCommandById("arvnfig:toggle-strict-headings");
  await wait(1200);
  ok(!/strict-headings/.test(await app.vault.read(f)), "toggle off removes property");
  h = lineOf("## Renamed Heading");
  cm.dispatch({ changes: { from: h.to, insert: "!" }, userEvent: "input.type" });
  await wait(300);
  ok(!!lineOf("## Renamed Heading!") && !modalText(), "unlocked note edits heading directly");

  // 10. Toggle on again -> locked
  cm.dispatch({ selection: { anchor: 0 } });
  app.commands.executeCommandById("arvnfig:toggle-strict-headings");
  await wait(1200);
  ok(/strict-headings: true/.test(await app.vault.read(f)), "toggle on adds property");
  h = lineOf("## Renamed Heading!");
  before = doc();
  cm.dispatch({ changes: { from: h.to, insert: "?" }, userEvent: "input.type" });
  await wait(500);
  ok(doc() === before && !!modalText(), "locked again after toggle on");
  await closeModals();

  // 11. Typing # at the start changes the level, no box
  h = lineOf("## Renamed Heading!");
  cm.dispatch({ changes: { from: h.from, insert: "#" }, selection: { anchor: h.from + 1 }, userEvent: "input.type" });
  await wait(400);
  ok(!!lineOf("### Renamed Heading!") && !modalText(), "typing # raises level, no box");

  // 12. Still locked after a typed level change (cursor still on the line)
  h = lineOf("### Renamed Heading!");
  before = doc();
  cm.dispatch({ changes: { from: h.to, insert: "z" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
  await wait(500);
  ok(doc() === before && !!modalText(), "still locked after typing #");
  await closeModals();

  // 13. Backspacing a # lowers the level, no box
  h = lineOf("### Renamed Heading!");
  cm.dispatch({ changes: { from: h.from + 2, to: h.from + 3 }, selection: { anchor: h.from + 2 }, userEvent: "delete.backward" });
  await wait(400);
  ok(!!lineOf("## Renamed Heading!") && !modalText(), "deleting # lowers level, no box");

  // 14. Set-heading hotkey command, then typing still opens the box
  h = lineOf("## Renamed Heading!");
  cm.dispatch({ selection: { anchor: h.to } });
  cm.focus();
  app.commands.executeCommandById("editor:set-heading-1");
  await wait(400);
  h = lineOf("# Renamed Heading!");
  ok(!!h && !modalText(), "set-heading command changes level");
  if (h) {
    before = doc();
    cm.dispatch({ changes: { from: h.to, insert: "q" }, selection: { anchor: h.to + 1 }, userEvent: "input.type" });
    await wait(500);
    ok(doc() === before && !!modalText(), "still locked after set-heading command");
    await closeModals();
  }

  // 15. Removing the last # (no longer a heading) is still blocked
  h = lineOf("# Renamed Heading!");
  if (h) {
    before = doc();
    cm.dispatch({ changes: { from: h.from, to: h.from + 2 }, userEvent: "delete.backward" });
    await wait(500);
    ok(doc() === before && !!modalText(), "removing heading marker blocked");
    await closeModals();
  }

  // 16. Undo that would change a locked heading's words is blocked, opens the box
  const ed = leaf.view.editor;
  h = lineOf("# Renamed Heading!");
  if (h) {
    await wait(700);
    cm.dispatch({ changes: { from: h.from + 2, to: h.to, insert: "Changed Heading" } });
    await wait(700);
    cm.dispatch({ selection: { anchor: 0 } });
    before = doc();
    ed.undo();
    await wait(500);
    ta = modalText();
    ok(doc() === before && ta && ta.value === "Renamed Heading!", `undo blocked, box prefilled: ${ta && JSON.stringify(ta.value)}`);
    await closeModals();
    // The undo step wasn't used up: undoing again gives the same box
    ed.undo();
    await wait(500);
    ok(doc() === before && !!modalText(), "undo history kept after block");
    await closeModals();
  }

  // 17. Undo of a level change is allowed
  h = lineOf("# Changed Heading");
  if (h) {
    await wait(700);
    cm.dispatch({ changes: { from: h.from, insert: "#" } });
    await wait(700);
    ed.undo();
    await wait(500);
    ok(!!lineOf("# Changed Heading") && !modalText(), "undo of level change allowed");
    // 18. Redo of it too
    ed.redo();
    await wait(500);
    ok(!!lineOf("## Changed Heading") && !modalText(), "redo of level change allowed");
  }

  // 18b. Ctrl+B (toggle bold) on a selection from a body line into a heading:
  // nothing changes and no box opens (a notice explains)
  h = lineOf("## Changed Heading");
  const intro = lineOf("intro");
  if (h && intro) {
    await wait(600);
    before = doc();
    cm.dispatch({ selection: { anchor: intro.from, head: h.from + 6 } });
    cm.focus();
    app.commands.executeCommandById("editor:toggle-bold");
    await wait(500);
    ok(doc() === before && !modalText(), "bold from body into heading: blocked, no box");
    await closeModals();
    // Ctrl+B inside one heading still opens the box with the bold text
    cm.dispatch({ selection: { anchor: h.from + 3, head: h.from + 10 } });
    cm.focus();
    app.commands.executeCommandById("editor:toggle-bold");
    await wait(500);
    ta = modalText();
    ok(doc() === before && ta && ta.value === "**Changed** Heading", `bold inside heading opens box: ${ta && JSON.stringify(ta.value)}`);
    await closeModals();
  } else ok(false, "bold tests: lines not found");

  // 19+. Multi-line deletes that remove headings follow the deleteMode setting
  const st = app.plugins.plugins.arvnfig.settings.lockedHeadings;
  const doc2 = "---\nstrict-headings: true\n---\n# Alpha\ntext\n## Beta\nmore [[#Beta]]\n";
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc2 }, selection: { anchor: doc2.length } });
  await leaf.view.save();
  await wait(1500);
  const bodyStart = doc2.indexOf("# Alpha");
  const delAll = () => cm.dispatch({ changes: { from: bodyStart, to: cm.state.doc.length }, userEvent: "delete.selection" });
  const confirmBox = () => document.querySelector(".modal.arvnfig-confirm-delete");
  const click = (box, sel) => { const b = box && box.querySelector(sel); if (b) b.click(); };

  st.deleteMode = "ask";
  delAll();
  await wait(500);
  let cbx = confirmBox();
  ok(doc() === doc2 && cbx && /2 locked headings/.test(cbx.textContent) && /1 link points/.test(cbx.textContent), `ask: box lists headings + links: ${cbx && JSON.stringify(cbx.textContent)}`);
  click(cbx, "button.mod-cancel");
  await wait(200);
  ok(doc() === doc2 && !confirmBox(), "ask: Cancel keeps text");
  delAll();
  await wait(500);
  click(confirmBox(), "button.mod-warning");
  await wait(300);
  ok(doc() === doc2.slice(0, bodyStart), "ask: Delete deletes");

  ed.undo();
  await wait(400);
  ok(doc() === doc2 && !confirmBox(), "undo of delete restores, no box");
  ed.redo();
  await wait(500);
  cbx = confirmBox();
  ok(doc() === doc2 && !!cbx, "redo of delete asks first");
  click(cbx, "button.mod-warning");
  await wait(300);
  ok(doc() === doc2.slice(0, bodyStart), "redo confirmed deletes");

  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc2 }, selection: { anchor: doc2.length } });
  await wait(200);
  st.deleteMode = "block";
  delAll();
  await wait(400);
  ok(doc() === doc2 && !confirmBox() && !modalText(), "block: nothing deleted, no box");
  st.deleteMode = "allow";
  delAll();
  await wait(400);
  ok(doc() === doc2.slice(0, bodyStart) && !confirmBox(), "allow: deleted silently");

  // Linked-only settings. Alpha has no links; Beta has [[#Beta]].
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc2 }, selection: { anchor: doc2.length } });
  await leaf.view.save();
  await wait(1500);
  st.deleteMode = "ask";
  st.deleteLinkedOnly = true;
  const alphaBlock = "# Alpha\ntext\n";
  cm.dispatch({ changes: { from: bodyStart, to: bodyStart + alphaBlock.length }, userEvent: "delete.selection" });
  await wait(400);
  ok(doc() === doc2.replace(alphaBlock, "") && !confirmBox(), "deleteLinkedOnly: unlinked heading deleted without asking");
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc2 }, selection: { anchor: doc2.length } });
  await wait(200);
  delAll();
  await wait(500);
  cbx = confirmBox();
  ok(doc() === doc2 && cbx && /Delete 1 locked heading\?/.test(cbx.textContent) && /## Beta/.test(cbx.textContent) && !/Alpha/.test(cbx.textContent), `deleteLinkedOnly: box lists only the linked heading: ${cbx && JSON.stringify(cbx.textContent)}`);
  click(cbx, "button.mod-cancel");
  await wait(200);
  st.deleteLinkedOnly = false;

  st.linkedOnly = true;
  let a = lineOf("# Alpha");
  cm.dispatch({ changes: { from: a.to, insert: "!" }, selection: { anchor: a.to + 1 }, userEvent: "input.type" });
  await wait(400);
  ok(!!lineOf("# Alpha!") && !modalText(), "linkedOnly: unlinked heading edits directly, no box");
  cm.dispatch({ selection: { anchor: cm.state.doc.length } });
  await wait(100);
  let b = lineOf("## Beta");
  cm.dispatch({ changes: { from: b.to, insert: "!" }, selection: { anchor: b.to + 1 }, userEvent: "input.type" });
  await wait(500);
  ta = modalText();
  ok(!!lineOf("## Beta") && ta && ta.value === "Beta!", `linkedOnly: linked heading still locked: ${ta && JSON.stringify(ta.value)}`);
  await closeModals();
  st.linkedOnly = false;

  // Find and replace (mass edits)
  const doc3 = "---\nstrict-headings: true\n---\n# Foo heading\nfoo body\n";
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc3 }, selection: { anchor: doc3.length } });
  await wait(300);
  const replaceAll = (from, to) => {
    const t = cm.state.doc.toString();
    const changes = [];
    for (let i = t.indexOf(from); i >= 0; i = t.indexOf(from, i + 1)) changes.push({ from: i, to: i + from.length, insert: to });
    cm.dispatch({ changes, userEvent: "searchReplace" });
  };
  st.massEditMode = "ask";
  replaceAll("oo", "aa");
  await wait(500);
  cbx = confirmBox();
  ok(doc() === doc3 && cbx && /Find and replace would change 1 locked heading/.test(cbx.textContent) && /# Foo heading/.test(cbx.textContent), `find/replace ask: box shows heading: ${cbx && JSON.stringify(cbx.textContent)}`);
  click(cbx, "button.mod-cancel");
  await wait(200);
  ok(doc() === doc3, "find/replace ask: Cancel keeps text");
  replaceAll("oo", "aa");
  await wait(500);
  click(confirmBox(), "button.mod-warning");
  await wait(300);
  ok(doc() === doc3.replace(/oo/g, "aa"), "find/replace ask: Replace anyway replaces");
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc3 }, selection: { anchor: doc3.length } });
  await wait(200);
  cm.dispatch({ changes: { from: doc3.indexOf("body"), to: doc3.indexOf("body") + 4, insert: "text" }, userEvent: "searchReplace" });
  await wait(300);
  ok(doc() === doc3.replace("body", "text") && !confirmBox(), "find/replace in body only: allowed, no box");
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc3 }, selection: { anchor: doc3.length } });
  st.massEditMode = "block";
  replaceAll("oo", "aa");
  await wait(400);
  ok(doc() === doc3 && !confirmBox(), "find/replace block: nothing replaced");

  // Obsidian's real Replace all button
  st.massEditMode = "ask";
  app.commands.executeCommandById("editor:open-search-replace");
  await wait(500);
  const sInputs = [...leaf.view.containerEl.querySelectorAll(".document-search-container input")];
  if (sInputs.length >= 2) {
    sInputs[0].value = "foo"; sInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    sInputs[1].value = "bar"; sInputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    await wait(300);
    [...leaf.view.containerEl.querySelectorAll(".document-search-container button, .document-search-container .document-search-button")].find((b) => /^Replace all/.test(b.textContent || b.getAttribute("aria-label") || ""))?.click();
    await wait(500);
    ok(doc() === doc3 && !!confirmBox(), "real Replace all: held, box opens");
    click(confirmBox(), "button.mod-cancel");
    await wait(200);
  } else ok(false, "real Replace all: search bar not found");
  leaf.view.containerEl.querySelector(".document-search-close-button")?.click();
  await wait(200);

  // A listed plugin's editor.setValue (stack shows plugin:<id>)
  st.massEditPlugins = "fake-replacer";
  const fakePlugin = eval("(function (ed, v) { ed.setValue(v); })\n//# sourceURL=plugin:fake-replacer");
  fakePlugin(leaf.view.editor, doc3.replace(/oo/g, "aa"));
  await wait(500);
  ok(doc() === doc3 && /fake-replacer would change 1 locked heading/.test(confirmBox()?.textContent ?? ""), `listed plugin: held, box opens: ${JSON.stringify(confirmBox()?.textContent)}`);
  click(confirmBox(), "button.mod-cancel");
  await wait(200);
  st.massEditPlugins = "";
  fakePlugin(leaf.view.editor, doc3.replace(/oo/g, "aa"));
  await wait(300);
  ok(doc() === doc3.replace(/oo/g, "aa") && !confirmBox(), "unlisted plugin: allowed");

  // Heading-path link suggestions
  const doc4 = "---\nstrict-headings: true\n---\n# Act 1\n## Part 2\n### My heading 3\n# Act 2\n## Part 2\n### My heading 3\n\n";
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: doc4 }, selection: { anchor: doc4.length } });
  await leaf.view.save();
  await wait(1500);
  const sugg = app.workspace.editorSuggest.suggests[0];
  ok(sugg && typeof sugg.find === "function", "path suggester registered first");
  const typed = "[[#act 1 part 2 heading 3";
  cm.dispatch({ changes: { from: doc4.length, insert: typed }, selection: { anchor: doc4.length + typed.length }, userEvent: "input.type" });
  await wait(600);
  const titles = [...document.querySelectorAll(".suggestion-container .suggestion-title")].map((e) => e.textContent);
  const notes = [...document.querySelectorAll(".suggestion-container .suggestion-note")].map((e) => e.textContent);
  ok(titles.length === 1 && titles[0] === "My heading 3" && notes[0] === "Act 1 › Part 2", `path suggestion shown: ${JSON.stringify(titles)} ${JSON.stringify(notes)}`);
  if (sugg.isOpen) sugg.suggestions.useSelectedItem(new KeyboardEvent("keydown"));
  await wait(300);
  const lastLine = cm.state.doc.line(cm.state.doc.lines).text;
  ok(lastLine === "[[#Act 1#Part 2#My heading 3]]", `duplicate heading gets full path: ${JSON.stringify(lastLine)}`);
  sugg.close();
  const trig = (text) => sugg.onTrigger({ line: 0, ch: text.length }, { getLine: () => text }, f);
  ok(trig("[[#act") === null, "one word: left to Obsidian's suggestions");
  ok(trig("[[Strict Heading Test#act 2 heading") !== null, "[[Note# form triggers");
  ok(trig("[[#zzz qqq") === null, "no match: left to Obsidian's suggestions");

  } catch (e) { out.push("ERROR " + e.message + " | doc=" + JSON.stringify(cm.state.doc.toString())); }
  Object.assign(app.plugins.plugins.arvnfig.settings.lockedHeadings, savedSettings);
  await closeModals();
  cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: original } });
  await wait(2500);
  await app.vault.modify(f, original);
  if (opened) leaf.detach();
  return out.join("\n");
})()
