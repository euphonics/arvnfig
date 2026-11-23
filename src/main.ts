import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import {
  DEFAULT_LOCKED_HEADINGS,
  lockedHeadingsExtension,
  type DeleteMode,
  type MassEditMode,
  type LockedHeadingsSettings,
} from "./features/lockedHeadings";
import { registerRenameLinks } from "./features/renameLinks";
import { registerHeadingPathSuggest } from "./features/headingPathSuggest";
import { registerCloseTabs } from "./features/closeTabs";

interface ArvnfigSettings {
  lockedHeadings: LockedHeadingsSettings;
  /** List the links to a heading in Obsidian's Rename heading box. */
  renameLinks: boolean;
  /** Suggest headings by their parent headings after [[# or [[Note#. */
  headingPathSuggest: boolean;
}

const DEFAULT_SETTINGS: ArvnfigSettings = {
  lockedHeadings: DEFAULT_LOCKED_HEADINGS,
  renameLinks: true,
  headingPathSuggest: true,
};

export default class ArvnfigPlugin extends Plugin {
  settings!: ArvnfigSettings;

  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(lockedHeadingsExtension(this.app, () => this.settings.lockedHeadings));
    this.addSettingTab(new ArvnfigSettingTab(this.app, this));
    registerRenameLinks(this, () => this.settings.renameLinks);
    registerHeadingPathSuggest(this, () => this.settings.headingPathSuggest);
    registerCloseTabs(this);

    this.addCommand({
      id: "toggle-strict-headings",
      name: "Toggle strict headings in current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.toggleStrictHeadings(file);
        return true;
      },
    });
  }

  /** Adds `<property>: true` to the note, or removes it if it's already true. */
  async toggleStrictHeadings(file: TFile) {
    const prop = this.settings.lockedHeadings.property;
    let nowOn = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const on = fm[prop] === true || fm[prop] === "true";
      if (on) delete fm[prop];
      else fm[prop] = true;
      nowOn = !on;
    });
    const vaultWide = this.settings.lockedHeadings.vaultWide;
    new Notice(
      nowOn
        ? `Strict headings on for "${file.basename}".`
        : `Strict headings off for "${file.basename}".` + (vaultWide ? " (Still locked: vault-wide setting is on.)" : ""),
    );
  }

  async loadSettings() {
    const data = (await this.loadData()) ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      lockedHeadings: { ...DEFAULT_LOCKED_HEADINGS, ...(data.lockedHeadings ?? {}) },
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ArvnfigSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ArvnfigPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings.lockedHeadings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl).setName("Locked headings").setHeading();

    new Setting(containerEl)
      .setName("Enable locked headings")
      .setDesc("Typing can't change an existing heading directly. Rename it with the Rename heading box (updates links): double-click it, or just start typing in it.")
      .addToggle((t) => t.setValue(s.enabled).onChange(async (v) => { s.enabled = v; await save(); }));

    new Setting(containerEl)
      .setName("Apply to the whole vault")
      .setDesc("Off: only notes whose property below is true. On: every note.")
      .addToggle((t) => t.setValue(s.vaultWide).onChange(async (v) => { s.vaultWide = v; await save(); }));

    new Setting(containerEl)
      .setName("Property name")
      .setDesc("Notes with this property set to true get locked headings.")
      .addText((t) => t.setValue(s.property).onChange(async (v) => { s.property = v.trim() || "strict-headings"; await save(); }));

    new Setting(containerEl)
      .setName("Open Rename heading when you type in a heading")
      .setDesc("On: changing a heading's text opens the Rename heading box with your edit in it. Off: the edit is just blocked.")
      .addToggle((t) => t.setValue(s.openRenameOnEdit).onChange(async (v) => { s.openRenameOnEdit = v; await save(); }));

    new Setting(containerEl)
      .setName("When an edit deletes several lines with headings")
      .setDesc("For example, select all and press Delete, or paste over a selection. Ask first: shows the headings and how many links to them would break. Block: the edit doesn't happen. Allow: deletes without asking.")
      .addDropdown((d) => d
        .addOptions({ ask: "Ask first", block: "Block", allow: "Allow" })
        .setValue(s.deleteMode)
        .onChange(async (v) => { s.deleteMode = v as DeleteMode; await save(); }));

    new Setting(containerEl)
      .setName("Only flag deleted headings that links point to")
      .setDesc("On: a multi-line delete only asks or blocks (per the setting above) if a link points to one of the headings it removes. Headings with no links are deleted without asking.")
      .addToggle((t) => t.setValue(s.deleteLinkedOnly).onChange(async (v) => { s.deleteLinkedOnly = v; await save(); }));

    new Setting(containerEl)
      .setName("Only lock headings that links point to")
      .setDesc("On: headings with no links pointing to them can be typed in, deleted and double-clicked like normal text. Headings with links stay locked.")
      .addToggle((t) => t.setValue(s.linkedOnly).onChange(async (v) => { s.linkedOnly = v; await save(); }));

    new Setting(containerEl)
      .setName("When find and replace changes locked headings")
      .setDesc("Covers Obsidian's find and replace and the plugins listed below. Ask first: shows the headings and how many links to them would break. Block: nothing is replaced. Allow: replaces without asking.")
      .addDropdown((d) => d
        .addOptions({ ask: "Ask first", block: "Block", allow: "Allow" })
        .setValue(s.massEditMode)
        .onChange(async (v) => { s.massEditMode = v as MassEditMode; await save(); }));

    new Setting(containerEl)
      .setName("Find-and-replace plugins")
      .setDesc("Plugin ids whose edits count as find and replace, separated by commas. Find a plugin's id in its folder name under .obsidian/plugins.")
      .addText((t) => t.setValue(s.massEditPlugins).onChange(async (v) => { s.massEditPlugins = v; await save(); }));

    new Setting(containerEl)
      .setName("Show a notice when an edit is blocked")
      .addToggle((t) => t.setValue(s.showNotice).onChange(async (v) => { s.showNotice = v; await save(); }));

    new Setting(containerEl).setName("Rename heading").setHeading();

    new Setting(containerEl)
      .setName("Show links in the Rename heading box")
      .setDesc("Lists every link that points to the heading, with its note and line, below the text box. Rename heading updates them all. Click one to open it. Works in every note, locked or not.")
      .addToggle((t) => t.setValue(this.plugin.settings.renameLinks).onChange(async (v) => { this.plugin.settings.renameLinks = v; await save(); }));

    new Setting(containerEl).setName("Links").setHeading();

    new Setting(containerEl)
      .setName("Find headings by their parent headings")
      .setDesc("After [[# or [[Note#, type words from the parent headings and then the heading, in order. E.g. [[#act 1 part 2 heading 3 finds \"My heading 3\" under \"Act 1\" › \"Part 2\". Needs at least two words; otherwise Obsidian's own suggestions show.")
      .addToggle((t) => t.setValue(this.plugin.settings.headingPathSuggest).onChange(async (v) => { this.plugin.settings.headingPathSuggest = v; await save(); }));
  }
}
