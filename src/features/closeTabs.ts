// Close tabs to the right / left of the active tab, in its own tab group only.
// Pinned tabs stay open, as with Obsidian's "Close all other tabs".

import type { Plugin, WorkspaceLeaf } from "obsidian";

type Side = "right" | "left";

/**
 * The active tab in the main area. If a sidebar has focus, the main-area tab
 * that was active last, so the command never closes sidebar tabs.
 */
function activeMainLeaf(plugin: Plugin): WorkspaceLeaf | null {
  const ws = plugin.app.workspace;
  return ws.getMostRecentLeaf(ws.rootSplit);
}

/** Tabs on one side of `leaf` in its tab group, nearest first. */
export function tabsBeside(leaf: WorkspaceLeaf, side: Side): WorkspaceLeaf[] {
  const siblings = ((leaf.parent as unknown as { children?: WorkspaceLeaf[] })?.children ?? []);
  const i = siblings.indexOf(leaf);
  if (i < 0) return [];
  return side === "right" ? siblings.slice(i + 1) : siblings.slice(0, i).reverse();
}

const isPinned = (leaf: WorkspaceLeaf): boolean => !!leaf.getViewState().pinned;

function closeBeside(plugin: Plugin, side: Side, checking: boolean): boolean {
  const leaf = activeMainLeaf(plugin);
  if (!leaf) return false;
  const targets = tabsBeside(leaf, side).filter((l) => !isPinned(l));
  if (checking) return targets.length > 0;
  for (const l of targets) l.detach();
  plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
  return true;
}

export function registerCloseTabs(plugin: Plugin): void {
  for (const side of ["right", "left"] as const) {
    plugin.addCommand({
      id: `close-tabs-to-the-${side}`,
      name: `Close tabs to the ${side}`,
      checkCallback: (checking) => closeBeside(plugin, side, checking),
    });
  }
}
