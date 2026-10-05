import assert from "node:assert/strict";
import esbuild from "esbuild";

// A small native-control DOM model: no Obsidian runtime or browser dependency.
const stub = `
export class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.classes = new Set(); this.textContent = ''; }
  createEl(tag, options = {}) { const el = new Element(tag); el.textContent = options.text || ''; if (options.cls) el.addClass(options.cls); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  empty() { this.children = []; this.textContent = ''; }
  setText(text) { this.textContent = text; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addClass(value) { this.classes.add(value); }
  toggleClass(value, enabled) { if (enabled) this.classes.add(value); else this.classes.delete(value); }
  focus() { globalThis.__ui.focused = this; }
}
export class Modal {
  constructor(app) { this.app = app; this.modalEl = new Element(); this.contentEl = new Element(); this.titleEl = new Element(); }
  open() { globalThis.__ui.modals.push(this); this.onOpen(); }
  close() { this.closed = true; this.onClose(); }
}
export class ButtonComponent {
  constructor(parent) { this.buttonEl = parent.createEl('button'); }
  setButtonText(value) { this.buttonEl.setText(value); return this; }
  setDisabled(value) { this.buttonEl.disabled = value; return this; }
  setWarning() { this.warning = true; return this; }
  setCta() { return this; }
  onClick(callback) { this.callback = callback; return this; }
  // Native buttons support Enter/Space without custom keyboard listeners.
  activate(key = 'Enter') { if (!this.buttonEl.disabled && ['Enter', ' '].includes(key)) this.callback(); }
}
export class TextComponent {
  constructor(parent) { this.inputEl = parent.createEl('input'); }
  setValue(value) { this.inputEl.value = value; return this; }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  onChange(callback) { this.callback = callback; return this; }
  type(value) { this.inputEl.value = value; this.callback(value); }
}
export class Setting {
  constructor(parent) { this.settingEl = parent.createDiv(); this.nameEl = this.settingEl.createDiv(); this.descEl = this.settingEl.createDiv(); this.buttons = []; globalThis.__ui.settings.push(this); }
  setName(value) { this.nameEl.setText(value); return this; }
  setDesc(value) { this.descEl.setText(value); return this; }
  addButton(callback) { const button = new ButtonComponent(this.settingEl); this.buttons.push(button); callback(button); return this; }
  addSearch(callback) { this.search = new TextComponent(this.settingEl); callback(this.search); return this; }
  addText(callback) { this.text = new TextComponent(this.settingEl); callback(this.text); return this; }
}
`;

const build = await esbuild.build({
	bundle: true, entryPoints: ["src/published-links.ts"], write: false,
	format: "esm", platform: "node", target: "node20",
	plugins: [{ name: "published-links-obsidian-stub", setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub }));
	} }]
});
const { filterPublishedLinks, PublishedLinksModal, PublishedLinkBindingModal } = await import(
	`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`
);
globalThis.__ui = { settings: [], modals: [], focused: undefined };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const rows = (modal) => globalThis.__ui.settings.filter((setting) => modal.listEl.children.includes(setting.settingEl));
const action = (setting, label) => {
	const button = setting.buttons.find((control) => control.buttonEl.textContent === label);
	assert.ok(button, `Missing button: ${label}`);
	assert.equal(button.buttonEl.tag, "button", "Actions retain native keyboard semantics");
	return button;
};
const entries = [
	{ id: "folder", kind: "folder", path: "docs", url: "https://example.com/wiki/folder" },
	{ id: "md", kind: "markdown", path: "docs/Alpha.md", name: "Alpha", url: "https://example.com/docx/alpha", token: "abc123" },
	{ id: "pdf", kind: "pdf", path: "docs/nested/manual.pdf", url: "" },
	{ id: "sibling", kind: "markdown", path: "docs-old/other.md", url: "https://example.com/docx/other" }
];
assert.deepEqual(filterPublishedLinks(entries, "", "/docs/").map((entry) => entry.id), ["folder", "md", "pdf"]);
assert.deepEqual(filterPublishedLinks(entries, "ALPHA abc123", "docs").map((entry) => entry.id), ["md"]);
assert.deepEqual(filterPublishedLinks(entries, "manual", "docs\\nested").map((entry) => entry.id), ["pdf"]);

let saved;
let removed = 0;
let refreshed = 0;
const host = {
	getLanguage: () => "en",
	listEntries: () => { refreshed += 1; return entries; },
	saveBindingUrl: (_entry, url) => {
		if (!url.startsWith("https://example.com/")) throw new Error("Host rejected the binding URL");
		saved = url;
	},
	removeBinding: () => { removed += 1; },
	copyUrl: () => { throw new Error("Clipboard permission denied"); }
};
const modal = new PublishedLinksModal({}, host, "docs");
modal.open();
await flush();
assert.equal(modal.titleEl.textContent, "Published links");
assert.equal(rows(modal).length, 3);
assert.equal(modal.countEl.textContent, "3 of 3 published links");
const toolbarFor = (target) => globalThis.__ui.settings.find((setting) => target.contentEl.children.includes(setting.settingEl) && setting.nameEl.textContent === "Folder scope");
assert.equal(toolbarFor(modal).buttons.length, 1, "Recovery is hidden when the host does not provide it");
const search = globalThis.__ui.settings.find((setting) => setting.search).search;
assert.equal(search.inputEl.attributes["aria-label"], "Search paths, names, URLs, or tokens");
search.inputEl.focus();
search.type("ABC123");
assert.equal(rows(modal).length, 1);
assert.equal(globalThis.__ui.focused, search.inputEl, "Search preserves focus while updating results");
const copy = action(rows(modal)[0], "Copy link");
copy.activate(" ");
await flush();
assert.equal(modal.feedbackEl.textContent, "Clipboard permission denied");
assert.ok(modal.feedbackEl.classes.has("is-error"));
assert.equal(copy.buttonEl.disabled, false, "Failed actions become retryable");
search.type("absent");
assert.equal(modal.listEl.children[0].textContent, "No published links match your search.");
search.type("manual");
assert.equal(action(rows(modal)[0], "Open link").buttonEl.disabled, true);
assert.equal(action(rows(modal)[0], "Copy link").buttonEl.disabled, true);

// Edit is also available for an unbound PDF; host errors preserve input and focus.
action(rows(modal)[0], "Edit binding").activate();
await flush();
const editor = globalThis.__ui.modals.at(-1);
assert.ok(editor instanceof PublishedLinkBindingModal);
const editorSettings = globalThis.__ui.settings.filter((setting) => editor.contentEl.children.includes(setting.settingEl));
const urlInput = editorSettings.find((setting) => setting.text).text;
assert.equal(globalThis.__ui.focused, urlInput.inputEl);
assert.equal(urlInput.inputEl.attributes["aria-label"], "Published URL");
assert.equal(urlInput.inputEl.attributes["aria-describedby"], editor.feedbackEl.id);
urlInput.type("invalid-url");
const save = action(editorSettings.at(-1), "Save binding");
save.activate();
await flush();
assert.equal(editor.closed, undefined);
assert.equal(editor.feedbackEl.textContent, "Host rejected the binding URL");
assert.equal(urlInput.inputEl.value, "invalid-url");
assert.equal(urlInput.inputEl.attributes["aria-invalid"], "true");
assert.equal(globalThis.__ui.focused, urlInput.inputEl, "Validation errors return focus to the URL field");
assert.equal(save.buttonEl.disabled, false);
urlInput.type("  https://example.com/docx/new  ");
save.activate();
await flush();
assert.equal(saved, "https://example.com/docx/new");
assert.equal(editor.closed, true);
assert.ok(refreshed >= 2);

// Disconnect requires explicit local-only confirmation; cancel never calls the host.
search.type("Alpha");
action(rows(modal)[0], "Disconnect local binding").activate();
await flush();
let confirmation = globalThis.__ui.modals.at(-1);
assert.match(confirmation.contentEl.children[1].textContent, /plugin settings.*Notes and remote/);
let footer = globalThis.__ui.settings.findLast((setting) => confirmation.contentEl.children.includes(setting.settingEl));
action(footer, "Cancel").activate();
assert.equal(removed, 0);
action(rows(modal)[0], "Disconnect local binding").activate();
await flush();
confirmation = globalThis.__ui.modals.at(-1);
footer = globalThis.__ui.settings.findLast((setting) => confirmation.contentEl.children.includes(setting.settingEl));
const disconnect = action(footer, "Disconnect local binding");
assert.equal(disconnect.warning, true);
disconnect.activate();
disconnect.activate();
await flush();
assert.equal(removed, 1, "Duplicate activation cannot submit twice");

// A refresh during sync must not leave newly rendered controls disabled.
let syncCount = 0;
let opened;
const syncModal = new PublishedLinksModal({}, {
	...host, openUrl: (url) => { opened = url; }, sync: () => { syncCount += 1; }
}, "docs");
syncModal.open();
await flush();
let markdown = rows(syncModal).find((setting) => setting.nameEl.textContent === "Alpha");
action(markdown, "Open link").activate();
await flush();
assert.equal(opened, entries[1].url);
action(markdown, "Sync").activate();
await flush();
assert.equal(syncCount, 1);
markdown = rows(syncModal).find((setting) => setting.nameEl.textContent === "Alpha");
assert.equal(action(markdown, "Sync").buttonEl.disabled, false);
assert.equal(syncModal.feedbackEl.textContent, "Sync completed.");
syncModal.close();

// Stored links with active-content schemes cannot reach the browser callback.
const unsafeModal = new PublishedLinksModal({}, {
	...host, listEntries: () => [{ ...entries[1], url: "javascript:alert(1)" }],
	openUrl: () => { assert.fail("Unsafe URL reached the host"); }
});
unsafeModal.open();
await flush();
action(rows(unsafeModal)[0], "Open link").activate();
await flush();
assert.equal(unsafeModal.feedbackEl.textContent, "The stored link must be an HTTP or HTTPS URL.");
unsafeModal.close();

// Bound lists stay small, with keyboard-operable pagination.
const many = Array.from({ length: 51 }, (_, index) => ({ ...entries[1], id: String(index), path: `docs/${String(index).padStart(2, "0")}.md` }));
const pagedModal = new PublishedLinksModal({}, { ...host, listEntries: () => many });
pagedModal.open();
await flush();
assert.equal(rows(pagedModal).length, 51, "50 records and one pagination setting");
let pager = rows(pagedModal).at(-1);
assert.equal(action(pager, "Previous").buttonEl.disabled, true);
action(pager, "Next").activate();
assert.equal(rows(pagedModal).length, 2);
pager = rows(pagedModal).at(-1);
assert.equal(pager.nameEl.textContent, "Page 2 of 2");
assert.equal(action(pager, "Next").buttonEl.disabled, true);
pagedModal.close();

// Recovery is useful with no durable document records; only the host writes bindings.
let recoveredEntries = [];
let recoveryScope;
let recoveryCalls = 0;
let completeRecovery;
const recoveryHost = {
	...host, listEntries: () => recoveredEntries,
	recoverBindings: (folderPath) => {
		recoveryScope = folderPath;
		recoveryCalls += 1;
		return new Promise((resolve) => { completeRecovery = resolve; });
	}
};
const recoveryModal = new PublishedLinksModal({}, recoveryHost, "/docs/");
recoveryModal.open();
await flush();
assert.equal(recoveryModal.listEl.children[0].textContent, "No published links in this scope.");
assert.ok(recoveryModal.contentEl.children.some((element) => /remote folder children.*uniquely matched local filenames.*Ambiguous matches need manual binding/.test(element.textContent)));
const recover = action(toolbarFor(recoveryModal), "Recover existing bindings");
recover.activate();
recover.activate(" ");
assert.equal(recoveryCalls, 1);
assert.equal(recoveryScope, "docs");
assert.equal(recover.buttonEl.disabled, true);
assert.equal(action(toolbarFor(recoveryModal), "Refresh").buttonEl.disabled, true);
assert.equal(recoveryModal.feedbackEl.textContent, "Recovering existing bindings…");
recoveredEntries = [entries[1]];
completeRecovery("Recovered 1 binding; 2 ambiguous matches need manual binding.");
await flush();
assert.equal(rows(recoveryModal).length, 1, "Recovered settings are refreshed into the list");
assert.equal(recoveryModal.feedbackEl.textContent, "Recovered 1 binding; 2 ambiguous matches need manual binding.");
assert.equal(recover.buttonEl.disabled, false);

recoveryHost.recoverBindings = () => { throw new Error("Remote folder listing failed"); };
recover.activate();
await flush();
assert.equal(recoveryModal.feedbackEl.textContent, "Remote folder listing failed");
assert.ok(recoveryModal.feedbackEl.classes.has("is-error"));
assert.equal(recover.buttonEl.disabled, false, "Failed recovery can be retried");
assert.equal(rows(recoveryModal).length, 1, "Failed recovery retains the existing list");

recoveryHost.recoverBindings = () => "Recovered 1 binding.";
recoveryHost.listEntries = () => { throw new Error("Settings refresh failed"); };
recover.activate();
await flush();
assert.equal(recoveryModal.feedbackEl.textContent, "Recovered 1 binding.\nSettings refresh failed", "Refresh failure keeps the recovery summary visible");
recoveryModal.close();

let rootScope;
const chineseRecovery = new PublishedLinksModal({}, {
	...host, getLanguage: () => "zh-CN", listEntries: () => [],
	recoverBindings: (folderPath) => { rootScope = folderPath; return "已恢复 0 个绑定。"; }
});
chineseRecovery.open();
await flush();
const chineseToolbar = globalThis.__ui.settings.find((setting) => chineseRecovery.contentEl.children.includes(setting.settingEl) && setting.nameEl.textContent === "文件夹范围");
assert.ok(chineseRecovery.contentEl.children.some((element) => /有歧义的匹配需手动绑定/.test(element.textContent)));
action(chineseToolbar, "恢复已有发布绑定").activate();
await flush();
assert.equal(rootScope, "", "The unscoped manager asks the host to recover all mapped folders");
assert.equal(chineseRecovery.feedbackEl.textContent, "已恢复 0 个绑定。");
chineseRecovery.close();

// Refresh failures retain the useful list; stale completion cannot reopen a closed UI.
host.listEntries = () => { throw new Error("Could not load settings"); };
await modal.refresh();
assert.equal(modal.feedbackEl.textContent, "Could not load settings");
assert.equal(rows(modal).length, 1);
let finish;
host.listEntries = () => new Promise((resolve) => { finish = resolve; });
const lateRefresh = modal.refresh();
modal.close();
finish(entries);
await lateRefresh;
assert.equal(modal.contentEl.children.length, 0);

const chinese = new PublishedLinksModal({}, { ...host, getLanguage: () => "zh-CN", listEntries: () => [] });
chinese.open();
await flush();
assert.equal(chinese.titleEl.textContent, "已发布链接");
assert.equal(chinese.listEl.children[0].textContent, "此范围内没有已发布链接。");
chinese.close();
delete globalThis.__ui;
console.log("Published links UI tests passed");
