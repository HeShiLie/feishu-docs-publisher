import assert from "node:assert/strict";
import esbuild from "esbuild";

await esbuild.build({
	bundle: true,
	entryPoints: ["src/main.ts"],
	format: "esm",
	outfile: "test/.tmp-main-test.mjs",
	platform: "node",
	target: "node20",
	plugins: [{
		name: "obsidian-test-stub",
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({
				path: "obsidian",
				namespace: "obsidian-test-stub"
			}));
			build.onLoad({ filter: /.*/, namespace: "obsidian-test-stub" }, () => ({
				contents: `
					export const addIcon = () => {};
					export class App {}
					export class FileSystemAdapter {}
					export class Menu {}
					export class Modal {}
					export class ButtonComponent {}
					export class TextComponent {}
					export class TFolder {}
					export class Notice {
						constructor(message, timeout) {
							globalThis.__obsidianNotices?.push({ message, timeout });
						}
					}
					export class Plugin {}
					export class PluginSettingTab {}
					export class Setting {}
					export class TFile {}
					globalThis.__TFileClass = TFile;
				`
			}));
		}
	}]
});

const { default: LarkCliSyncPlugin } = await import("./.tmp-main-test.mjs");

function createPlugin() {
	const plugin = Object.create(LarkCliSyncPlugin.prototype);
	plugin.settings = {
		language: "zh-CN",
		updateFrontmatter: false,
		documentBindings: {},
		pendingDocumentCreates: {},
		pendingFolderCreates: {},
		disconnectedBindings: {},
		disconnectedFolders: {},
		pdfBindings: {},
		folderBindings: {},
		publishedFolders: {},
		targetTokenOrUrl: ""
	};
	plugin.saveData = async () => {};
	return plugin;
}

const policyPlugin = createPlugin();
assert.deepEqual(policyPlugin.getRemoteStateRefreshPolicy("save"), {
	attempts: 8,
	delayMs: 1500,
	allowTimeoutFallback: true
});

const diagnosticPlugin = createPlugin();
const diagnosticWarnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
	diagnosticWarnings.push(args);
};
try {
	diagnosticPlugin.logRemoteStateRefreshTimeout("doc-token", 8, 15, {
		rejectReason: "revision-lag",
		observedRevisionId: 14
	});

	const incompleteState = {
		doc: "doc-token",
		revisionId: 15,
		contentHash: "hash",
		units: [{
			stableId: "0:paragraph",
			kind: "paragraph",
			hash: "hash",
			blockId: ""
		}],
		updatedAt: "2026-08-13T00:00:00.000Z"
	};
	diagnosticPlugin.logRemoteStateRefreshTimeout(
		"doc-token",
		8,
		15,
		diagnosticPlugin.createBlockMappingDiagnostic(incompleteState)
	);
} finally {
	console.warn = originalWarn;
}
assert.deepEqual(diagnosticWarnings[0][1], {
	doc: "doc-token",
	attempts: 8,
	expectedRevisionId: 15,
	observedRevisionId: 14,
	unitCount: undefined,
	missingBlockIdCount: undefined,
	rejectReason: "revision-lag"
});
assert.deepEqual(diagnosticWarnings[1][1], {
	doc: "doc-token",
	attempts: 8,
	expectedRevisionId: 15,
	observedRevisionId: 15,
	unitCount: 1,
	missingBlockIdCount: 1,
	rejectReason: "block-mapping-incomplete"
});

const retryPlugin = createPlugin();
let fetchCount = 0;
const sleepDelays = [];
let persistedState;
const confirmedState = {
	doc: "doc-token",
	revisionId: 15,
	contentHash: "hash",
	units: [{
		stableId: "0:paragraph",
		kind: "paragraph",
		hash: "hash",
		blockId: "block-1"
	}],
	updatedAt: "2026-08-13T00:00:00.000Z"
};
retryPlugin.fetchRemoteDocumentStateAfterExpectedRevision = async () => {
	fetchCount += 1;
	return fetchCount < 8
		? undefined
		: confirmedState;
};
retryPlugin.sleep = async (delayMs) => {
	sleepDelays.push(delayMs);
};
retryPlugin.persistDocumentState = async (state) => {
	persistedState = state;
};
await retryPlugin.saveRemoteDocumentState("doc-token", [], {
	expectedRevisionId: 15,
	updateSubmitted: true,
	context: { mode: "save", path: "docs/a.md" },
	refreshPolicy: retryPlugin.getRemoteStateRefreshPolicy("save")
});
assert.equal(fetchCount, 8);
assert.deepEqual(sleepDelays, Array(7).fill(1500));
assert.equal(persistedState, confirmedState);

const wiringPlugin = createPlugin();
let confirmationOptions;
wiringPlugin.withTempMarkdown = async (_baseName, _content, callback) => {
	return await callback({ directory: "/tmp", fileName: "sync.md" });
};
wiringPlugin.runLarkCli = async () => ({
	ok: true,
	data: { document: { revision_id: 15 } }
});
wiringPlugin.saveRemoteDocumentState = async (_doc, _stateKeys, options) => {
	confirmationOptions = options;
};
await wiringPlugin.executeSyncPlan("doc-token", { content: "Body", images: [] }, {
	mode: "precise",
	commands: [{
		doc: "doc-token",
		command: "block_delete",
		blockId: "block-1"
	}],
	contentHash: "hash"
}, {
	mode: "save",
	path: "docs/a.md",
	stateKeys: []
});
assert.equal(confirmationOptions.expectedRevisionId, 15);
assert.equal(confirmationOptions.updateSubmitted, true);
assert.deepEqual(confirmationOptions.refreshPolicy, {
	attempts: 8,
	delayMs: 1500,
	allowTimeoutFallback: true
});

const createBindingPlugin = createPlugin();
createBindingPlugin.withTempMarkdown = async (_baseName, _content, callback) => {
	return await callback({ directory: "/tmp", fileName: "note.md" });
};
createBindingPlugin.resolveRemoteRootParent = async () => ({ token: "parent-token" });
createBindingPlugin.runLarkCli = async () => ({
	ok: true,
	data: { document: { document_id: "created-token", url: "https://example.com/docx/created-token" } }
});
createBindingPlugin.materializeLocalImages = async () => {
	throw new Error("image upload failed");
};
let provisionalBinding;
await assert.rejects(
	createBindingPlugin.createLarkDocument(
		{ basename: "Note", path: "Note.md" },
		{ content: "Body", images: [{}] },
		undefined,
		async (binding) => {
			provisionalBinding = binding;
		}
	),
	/image upload failed/
);
assert.deepEqual(provisionalBinding, {
	token: "created-token",
	url: "https://example.com/docx/created-token"
});

const stagedCreatePlugin = createPlugin();
const stagedCreateEvents = [];
const stagedTempContents = [];
const stagedBatchContents = [];
stagedCreatePlugin.withTempMarkdown = async (_baseName, content, callback) => {
	stagedTempContents.push(content);
	return await callback({ directory: "/tmp", fileName: "note.md" });
};
stagedCreatePlugin.writeTempMarkdown = async (_directory, _baseName, content) => {
	stagedBatchContents.push(content);
	return `batch-${stagedBatchContents.length}.md`;
};
stagedCreatePlugin.resolveRemoteRootParent = async () => ({ token: "parent-token" });
stagedCreatePlugin.runLarkCli = async (args) => {
	if (args[1] === "+create") {
		stagedCreateEvents.push("create");
		return {
			ok: true,
			data: { document: { document_id: "large-token", url: "https://example.com/docx/large-token" } }
		};
	}
	stagedCreateEvents.push("append");
	return {
		ok: true,
		data: { document: { revision_id: stagedCreateEvents.length } }
	};
};
stagedCreatePlugin.materializeLocalImages = async () => {};
const largeBodyUnits = Array.from({ length: 401 }, (_, index) => `Paragraph ${index}`).join("\n\n");
await stagedCreatePlugin.createLarkDocument(
	{ basename: "Large", path: "Large.md" },
	{ content: `# Large\n\n${largeBodyUnits}`, images: [] },
	undefined,
	async () => {
		stagedCreateEvents.push("bind");
	}
);
assert.equal(stagedTempContents[0], "");
assert.deepEqual(stagedCreateEvents.slice(0, 3), ["create", "bind", "append"]);
assert.equal(stagedBatchContents.length, 5);

const stagedResumePlugin = createPlugin();
stagedResumePlugin.findDocumentState = () => undefined;
stagedResumePlugin.fetchLarkDocumentMarkdown = async () => ({
	content: `# Large\n\n${Array.from({ length: 100 }, (_, index) => `Paragraph ${index}`).join("\n\n")}`,
	revisionId: 10
});
let resumedBatches;
stagedResumePlugin.appendStagedDocumentBatches = async (_doc, batches) => {
	resumedBatches = batches;
	return 20;
};
stagedResumePlugin.materializeLocalImages = async () => undefined;
let resumedBaseline;
stagedResumePlugin.saveRemoteDocumentStateFromBaselineAfterExpectedRevision = async (
	_doc,
	_stateKeys,
	baselineMarkdown,
	expectedRevisionId
) => {
	resumedBaseline = { baselineMarkdown, expectedRevisionId };
};
const resumedDocument = await stagedResumePlugin.tryResumeStagedDocumentPublish(
	"large-token",
	{ content: `# Large\n\n${largeBodyUnits}`, images: [] },
	{ mode: "manual", path: "large.md", stateKeys: [] }
);
assert.equal(resumedDocument.revisionId, 20);
assert.equal(resumedBatches.length, 4);
assert.deepEqual(resumedBaseline, {
	baselineMarkdown: `# Large\n\n${largeBodyUnits}`,
	expectedRevisionId: 20
});

const bindingWriterPlugin = createPlugin();
bindingWriterPlugin.settings.updateFrontmatter = true;
const writtenFrontmatter = {
	lark_doc_token: "legacy-token"
};
bindingWriterPlugin.selfWrittenPaths = new Map();
bindingWriterPlugin.getBinding = () => null;
bindingWriterPlugin.app = {
	vault: {
		read: async () => "Body",
		modify: async () => {}
	},
	fileManager: {
		processFrontMatter: async (_file, update) => update(writtenFrontmatter)
	}
};
await bindingWriterPlugin.writeBinding({ path: "note.md" }, {
	token: "created-token",
	url: "https://example.com/wiki/wiki-node"
});
assert.deepEqual(writtenFrontmatter, {
	lark_doc_url: "https://example.com/wiki/wiki-node"
});

const aliasBootstrapPlugin = createPlugin();
const reusableState = {
	doc: "doc-token",
	revisionId: 4,
	contentHash: "previous-hash",
	units: [{
		stableId: "0:paragraph",
		kind: "paragraph",
		hash: "body-hash",
		blockId: "block-1"
	}],
	updatedAt: "2026-08-16T00:00:00.000Z"
};
aliasBootstrapPlugin.syncState = {
	version: 1,
	documents: { "doc-token": reusableState }
};
aliasBootstrapPlugin.fetchLarkDocumentMarkdown = async () => ({
	doc: "doc-token",
	content: "# Note\n\nBody",
	revisionId: 4
});
aliasBootstrapPlugin.fetchLarkDocumentWithIds = async () => ({
	doc: "doc-token",
	content: "<title id=\"doc-token\">Note</title><p id=\"block-1\">Body</p>",
	revisionId: 4
});
let persistedAliasState;
aliasBootstrapPlugin.persistDocumentState = async (state) => {
	persistedAliasState = state;
};
const bootstrappedAliasState = await aliasBootstrapPlugin.tryBootstrapPreciseSyncState(
	"https://example.com/wiki/wiki-node",
	["https://example.com/wiki/wiki-node"],
	"# Note\n\nBody\n\nFEISHU_LARK_LOCAL_IMAGE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
);
assert.equal(bootstrappedAliasState, reusableState);
assert.equal(persistedAliasState, reusableState);

const timeoutPlugin = createPlugin();
timeoutPlugin.fetchLarkDocumentWithIds = async () => ({
	doc: "doc-token",
	content: "<p id=\"block-1\">Body</p>",
	revisionId: 14
});
const timeoutDiagnostics = [];
timeoutPlugin.logRemoteStateRefreshTimeout = (...args) => {
	timeoutDiagnostics.push(args);
};
timeoutPlugin.sleep = async () => {};
const warnings = [];
console.warn = (...args) => {
	warnings.push(args);
};
let timeoutError;
try {
	await timeoutPlugin.saveRemoteDocumentState("doc-token", [], {
		expectedMarkdown: "Body",
		expectedRevisionId: 15,
		updateSubmitted: true,
		context: { mode: "save", path: "docs/a.md" },
		refreshPolicy: timeoutPlugin.getRemoteStateRefreshPolicy("save")
	});
} catch (error) {
	timeoutError = error;
} finally {
	console.warn = originalWarn;
}
assert.equal(timeoutError?.updateSubmitted, true);
assert.equal(warnings.length, 0);
assert.deepEqual(timeoutDiagnostics, [["doc-token", 8, 15, {
	rejectReason: "revision-lag",
	observedRevisionId: 14
}]]);

const overwritePlugin = createPlugin();
overwritePlugin.fetchLarkDocumentWithIds = async () => ({
	doc: "doc-token",
	content: "<p id=\"block-1\">Body</p>",
	revisionId: 15
});
overwritePlugin.fetchLarkDocumentMarkdown = async () => ({
	doc: "doc-token",
	content: "stale",
	revisionId: 15
});
overwritePlugin.isRemoteMarkdownContentEquivalent = async () => false;
overwritePlugin.sleep = async () => {};
const overwriteDiagnostics = [];
overwritePlugin.logRemoteStateRefreshTimeout = (...args) => {
	overwriteDiagnostics.push(args);
};
let overwriteError;
try {
	await overwritePlugin.saveRemoteDocumentStateFromBaselineAfterExpectedRevision(
		"doc-token",
		[],
		"Body",
		15,
		{ mode: "save", path: "docs/a.md" }
	);
} catch (error) {
	overwriteError = error;
}
assert.equal(overwriteError?.updateSubmitted, true);
assert.deepEqual(overwriteDiagnostics, [["doc-token", 8, 15, {
	rejectReason: "content-not-equivalent",
	observedRevisionId: 15
}]]);

const noticePlugin = createPlugin();
noticePlugin.autoSyncRunningPaths = new Set();
noticePlugin.autoSyncPendingPaths = new Set();
noticePlugin.syncFileInternal = async () => {
	throw timeoutError;
};
globalThis.__obsidianNotices = [];
console.warn = () => {};
try {
	await noticePlugin.runSaveAutoSync({ path: "docs/a.md" });
} finally {
	console.warn = originalWarn;
}
assert.deepEqual(globalThis.__obsidianNotices, [{
	message: "内容已提交，但远端状态确认超时：docs/a.md\n请稍后检查飞书文档。",
	timeout: 10000
}]);
delete globalThis.__obsidianNotices;

const deletedRemotePlugin = createPlugin();
deletedRemotePlugin.autoSyncRunningPaths = new Set();
deletedRemotePlugin.autoSyncPendingPaths = new Set();
deletedRemotePlugin.selfWrittenPaths = new Map();
deletedRemotePlugin.syncStateChangedKeys = new Set();
deletedRemotePlugin.syncStateRemovedKeys = new Set();
deletedRemotePlugin.syncState = {
	version: 1,
	documents: {
		"deleted-token": {
			doc: "deleted-token",
			contentHash: "hash",
			units: [],
			updatedAt: "2026-08-27T00:00:00.000Z"
		}
	}
};
const deletedRemoteBinding = {
	token: "deleted-token",
	url: "https://example.feishu.cn/docx/deleted-token"
};
deletedRemotePlugin.getBinding = () => deletedRemoteBinding;
deletedRemotePlugin.syncFileInternal = async () => {
	throw new Error('{"code":3380003,"message":"Document page has been deleted"}');
};
const deletedRemoteFrontmatter = {
	lark_doc: "legacy",
	lark_doc_url: deletedRemoteBinding.url,
	lark_doc_token: deletedRemoteBinding.token,
	lark_doc_synced_at: "2026-08-27",
	remoteRoot: "root",
	remoteParentPath: "path",
	tags: ["sync"]
};
deletedRemotePlugin.app = {
	metadataCache: { getFileCache: () => ({ frontmatter: deletedRemoteFrontmatter }) },
	vault: {
		getAbstractFileByPath: () => ({ path: "docs/deleted-remote.md" })
	},
	fileManager: {
		processFrontMatter: async (_file, update) => update(deletedRemoteFrontmatter)
	}
};
let deletedRemoteStateSaved = false;
deletedRemotePlugin.saveLarkSyncState = async () => {
	deletedRemoteStateSaved = true;
};
const deletedRemoteWarnings = [];
globalThis.__obsidianNotices = [];
console.warn = (...args) => {
	deletedRemoteWarnings.push(args);
};
try {
	await deletedRemotePlugin.runSaveAutoSync({ path: "docs/deleted-remote.md" });
} finally {
	console.warn = originalWarn;
}
assert.deepEqual(deletedRemoteFrontmatter, { tags: ["sync"] });
assert.equal(deletedRemotePlugin.syncState.documents["deleted-token"], undefined);
assert.equal(deletedRemoteStateSaved, true);
assert.equal(deletedRemoteWarnings.length, 1);
assert.deepEqual(globalThis.__obsidianNotices, [{
	message: "飞书文档远端已删除，已自动解绑：docs/deleted-remote.md\n如需重新发布，请再次执行“同步到飞书”。",
	timeout: 10000
}]);
delete globalThis.__obsidianNotices;

const deletedNotePlugin = createPlugin();
deletedNotePlugin.autoSyncRunningPaths = new Set();
deletedNotePlugin.autoSyncPendingPaths = new Set();
deletedNotePlugin.app = {
	vault: {
		getAbstractFileByPath: () => null
	}
};
deletedNotePlugin.syncFileInternal = async () => {
	const error = new Error("ENOENT: no such file or directory");
	error.code = "ENOENT";
	throw error;
};
const autoSyncErrors = [];
const originalError = console.error;
globalThis.__obsidianNotices = [];
console.error = (...args) => {
	autoSyncErrors.push(args);
};
try {
	await deletedNotePlugin.runSaveAutoSync({ path: "docs/deleted.md" });
} finally {
	console.error = originalError;
}
assert.deepEqual(globalThis.__obsidianNotices, []);
assert.deepEqual(autoSyncErrors, []);
delete globalThis.__obsidianNotices;

deletedNotePlugin.app.vault.getAbstractFileByPath = () => ({ path: "docs/existing.md" });
const existingNoteErrors = [];
globalThis.__obsidianNotices = [];
console.error = (...args) => {
	existingNoteErrors.push(args);
};
try {
	await deletedNotePlugin.runSaveAutoSync({ path: "docs/existing.md" });
} finally {
	console.error = originalError;
}
assert.deepEqual(globalThis.__obsidianNotices, [{
	message: "自动同步失败：docs/existing.md\nENOENT: no such file or directory",
	timeout: 10000
}]);
assert.equal(existingNoteErrors.length, 1);
delete globalThis.__obsidianNotices;


// First publish without frontmatter remains bound through metadata lag and failed post-write work.
function createPublishingPlugin() {
	const plugin = createPlugin();
	plugin.settings.openAfterSync = false;
	plugin.settings.titleSource = "file-name";
	plugin.selfWrittenPaths = new Map();
	plugin.syncState = { version: 1, documents: {} };
	plugin.syncStateChangedKeys = new Set();
	plugin.syncStateRemovedKeys = new Set();
	plugin.saveLarkSyncState = async () => {};
	plugin.app = {
		metadataCache: { getFileCache: () => null },
		vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null,
			read: async () => { throw new Error("Frontmatter-off publishing must not edit the note"); } },
		fileManager: { processFrontMatter: async () => { throw new Error("Unexpected frontmatter write"); } }
	};
	plugin.readNoteForLark = async () => ({ content: "# Note\n\nBody", images: [] });
	plugin.resolvePublishedFolderParentForFile = async () => null;
	plugin.resolveRemoteRootParent = async () => ({ kind: "my_library", token: "" });
	plugin.withTempMarkdown = async (_name, _content, callback) => callback({ directory: "/tmp", fileName: "note.md" });
	plugin.materializeLocalImages = async () => {};
	plugin.saveCreatedDocumentStateFromBaseline = async () => {};
	return plugin;
}
const publishOptions = { allowCreate: true, openAfterSync: false, showSuccess: false,
	showRemoteDeletedNotice: false, updateFrontmatter: false, mode: "manual" };
const fakeNote = { path: "docs/Note.md", basename: "Note", name: "Note.md", extension: "md" };
const canonicalBinding = { token: "remote-doc", url: "https://example.feishu.cn/docx/remote-doc" };
const concurrentPlugin = createPublishingPlugin();
let createdCount = 0, updatedCount = 0;
const savedSnapshots = [];
concurrentPlugin.saveData = async (settings) => { savedSnapshots.push(settings); };
concurrentPlugin.runLarkCli = async () => {
	createdCount++;
	await new Promise((resolve) => setTimeout(resolve, 5));
	return { ok: true, data: { document: { document_id: canonicalBinding.token, url: canonicalBinding.url } } };
};
concurrentPlugin.updateLarkDocument = async () => { updatedCount++; return {}; };
await Promise.all([
	concurrentPlugin.syncFileInternal(fakeNote, publishOptions),
	concurrentPlugin.syncFileInternal(fakeNote, publishOptions),
	concurrentPlugin.syncFileInternal(fakeNote, { ...publishOptions, mode: "save", allowCreate: false })
]);
assert.equal(createdCount, 1, "overlapping manual/save publishes must create only once");
assert.equal(updatedCount, 2);
assert.equal(concurrentPlugin.getBinding(fakeNote).token, canonicalBinding.token);
assert.ok(savedSnapshots.some((data) => data.documentBindings[fakeNote.path]?.token === canonicalBinding.token));
const restartPlugin = createPublishingPlugin();
restartPlugin.settings = JSON.parse(JSON.stringify(savedSnapshots.at(-1)));
assert.equal(restartPlugin.getBinding(fakeNote).token, canonicalBinding.token, "binding survives a plugin restart without frontmatter");

const partialPublishPlugin = createPublishingPlugin();
let partialCreates = 0;
partialPublishPlugin.runLarkCli = async () => { partialCreates++; return {
	ok: true, data: { document: { document_id: canonicalBinding.token, url: canonicalBinding.url } }
}; };
partialPublishPlugin.materializeLocalImages = async () => { throw new Error("image upload failed after creation"); };
await assert.rejects(partialPublishPlugin.syncFileInternal(fakeNote, publishOptions), /image upload failed/);
assert.equal(partialPublishPlugin.getBinding(fakeNote).token, canonicalBinding.token);
partialPublishPlugin.updateLarkDocument = async () => ({});
await partialPublishPlugin.syncFileInternal(fakeNote, publishOptions);
assert.equal(partialCreates, 1, "retry after image failure must reuse the created document");

const ambiguousFailurePlugin = createPublishingPlugin();
ambiguousFailurePlugin.updateLarkDocument = async () => { throw new Error("block not found"); };
ambiguousFailurePlugin.createLarkDocument = async () => { throw new Error("Must not recreate on missing blocks"); };
await assert.rejects(ambiguousFailurePlugin.syncOrRecreateDocument(fakeNote, canonicalBinding,
	{ content: "Body", images: [] }, undefined, { ...publishOptions, allowRecreate: true, path: fakeNote.path }), /block not found/);
assert.equal(ambiguousFailurePlugin.isRemoteDocumentDeletedError(new Error("image not exist")), false);
assert.equal(ambiguousFailurePlugin.isRemoteDocumentDeletedError(new Error("3380003 Document page has been deleted")), true);

const cacheLagPlugin = createPublishingPlugin();
cacheLagPlugin.settings.documentBindings[fakeNote.path] = canonicalBinding;
cacheLagPlugin.app.metadataCache.getFileCache = () => ({ frontmatter: { lark_doc_url: "https://example.feishu.cn/docx/stale" } });
assert.deepEqual(cacheLagPlugin.getBinding(fakeNote), canonicalBinding);
const legacyPlugin = createPublishingPlugin();
legacyPlugin.app.metadataCache.getFileCache = () => ({ frontmatter: { lark_doc_url: canonicalBinding.url } });
assert.equal(legacyPlugin.getBinding(fakeNote).url, canonicalBinding.url);

const renamedPlugin = createPublishingPlugin();
renamedPlugin.getVaultRoot = () => "/tmp/vault";
renamedPlugin.settings.documentBindings = { "docs/Note.md": canonicalBinding, "docs-other.md": { token: "other", url: "" } };
renamedPlugin.settings.publishedFolders = { docs: { rootParent: { kind: "my_library", token: "" }, remoteRoot: "docs" } };
await renamedPlugin.moveLocalBindings("docs", "renamed");
assert.equal(renamedPlugin.getBinding({ path: "renamed/Note.md" }).token, canonicalBinding.token);
assert.equal(renamedPlugin.settings.documentBindings["docs/Note.md"], undefined);
assert.equal(renamedPlugin.settings.documentBindings["docs-other.md"].token, "other");
assert.ok(renamedPlugin.settings.publishedFolders.renamed);
assert.equal(renamedPlugin.settings.publishedFolders.renamed.remoteRoot, "docs", "rename preserves the existing remote root");

const folderRegistryPlugin = createPublishingPlugin();
folderRegistryPlugin.settings.publishedFolders = { "notes/docs": { rootParent: { kind: "my_library", token: "" }, remoteRoot: "docs" } };
folderRegistryPlugin.settings.folderBindings = {
	"my_library|my_library||docs": { token: "root-node", url: "https://example.feishu.cn/wiki/root-node" },
	"my_library|my_library||docs/sub": { token: "sub-node", url: "https://example.feishu.cn/wiki/sub-node" },
	"my_library|my_library||docs-other": { token: "other-node", url: "https://example.feishu.cn/wiki/other-node" }
};
folderRegistryPlugin.settings.documentBindings["notes/docs/Note.md"] = canonicalBinding;
folderRegistryPlugin.settings.targetTokenOrUrl = "https://example.feishu.cn/wiki/new-default";
assert.equal(folderRegistryPlugin.getPublishedEntry("notes/docs/sub", "folder").token, "sub-node");
await folderRegistryPlugin.disconnectFolderBinding("notes/docs");
assert.equal(folderRegistryPlugin.settings.folderBindings["my_library|my_library||docs"], undefined);
assert.equal(folderRegistryPlugin.settings.folderBindings["my_library|my_library||docs/sub"], undefined);
assert.equal(folderRegistryPlugin.settings.folderBindings["my_library|my_library||docs-other"].token, "other-node");
assert.equal(folderRegistryPlugin.settings.documentBindings["notes/docs/Note.md"].token, "remote-doc");

const localUnbindPlugin = createPublishingPlugin();
localUnbindPlugin.settings.documentBindings[fakeNote.path] = canonicalBinding;
await localUnbindPlugin.unbindDeletedRemoteDocument(fakeNote, canonicalBinding);
assert.equal(localUnbindPlugin.settings.documentBindings[fakeNote.path], undefined);

// Folder sync waits for an earlier manual operation; a failure releases the queue.
const queuedPlugin = createPublishingPlugin();
const orderedEvents = [];
queuedPlugin.syncFileUnlocked = async () => { orderedEvents.push("manual-start");
	await new Promise((resolve) => setTimeout(resolve, 5)); orderedEvents.push("manual-end"); throw new Error("manual failure"); };
queuedPlugin.withDeferredLarkSyncStateSave = async (callback) => callback();
queuedPlugin.collectMarkdownFiles = () => { orderedEvents.push("folder-start"); return []; };
queuedPlugin.app.vault.getFiles = () => [];
const orderedResults = await Promise.allSettled([
	queuedPlugin.syncFileInternal(fakeNote, publishOptions), queuedPlugin.publishFolderInternal("docs")
]);
assert.equal(orderedResults[0].status, "rejected");
assert.equal(orderedResults[1].status, "fulfilled");
assert.deepEqual(orderedEvents, ["manual-start", "manual-end", "folder-start"]);


const staleDestinationPlugin = createPublishingPlugin();
staleDestinationPlugin.syncState.documents.staleAlias = { doc: "oldDocument", units: [] };
assert.equal(staleDestinationPlugin.findDocumentState(["newDocument", "staleAlias"], "newDocument"), undefined);
const nestedRenamePlugin = createPublishingPlugin();
nestedRenamePlugin.settings.publishedFolders.Root = { rootParent: { kind: "my_library", token: "" }, remoteRoot: "Root" };
nestedRenamePlugin.settings.folderBindings = {
	"my_library|my_library||Root": { token: "root-node", url: "https://example.feishu.cn/wiki/root-node", containerKind: "my_library" },
	"my_library|my_library||Root/Sub": { token: "sub-node", url: "https://example.feishu.cn/wiki/sub-node", containerKind: "my_library" }
};
await nestedRenamePlugin.moveLocalBindings("Root/Sub", "Root/Renamed");
assert.equal(nestedRenamePlugin.getPublishedEntry("Root/Renamed", "folder").token, "sub-node");
assert.equal(nestedRenamePlugin.getPublishedEntry("Root/Sub", "folder"), undefined);
await nestedRenamePlugin.disconnectPublishedBinding({ path: "Root/Renamed", kind: "folder" });
assert.equal(nestedRenamePlugin.findPublishedFolderForFile({ path: "Root/Renamed/New.md" }), null);
assert.ok(nestedRenamePlugin.findPublishedFolderForFile({ path: "Root/Other/New.md" }));

const recoverPlugin = createPublishingPlugin();
recoverPlugin.listRemoteDocuments = async () => [{ title: "Note", token: "existing-note", url: "https://example.feishu.cn/docx/existing-note" }];
const parentsForRecovery = new Map([["Root", { kind: "my_library", token: "root-node" }]]);
const preparedForRecovery = () => ({ file: fakeNote, binding: null, remoteParentPath: "Root", preparedContent: {content: "# Note\n\nBody", images:[]} });
const recovered = preparedForRecovery();
assert.deepEqual(await recoverPlugin.recoverPreparedBindings([recovered], parentsForRecovery, true), {recovered:1,conflicts:0});
assert.equal(recovered.binding.token, "existing-note");
const duplicateLocalRecovery = createPublishingPlugin();
duplicateLocalRecovery.listRemoteDocuments = recoverPlugin.listRemoteDocuments;
const duplicatePrepared = preparedForRecovery();
const otherPrepared = { ...preparedForRecovery(), file: { ...fakeNote, path:"docs/Other.md" } };
await assert.rejects(duplicateLocalRecovery.recoverPreparedBindings([duplicatePrepared,otherPrepared], parentsForRecovery, true), /同名冲突/);
assert.deepEqual(duplicateLocalRecovery.settings.documentBindings, {}, "local title ambiguity must bind neither note");
const legacyRecovery = createPublishingPlugin();
legacyRecovery.listRemoteDocuments = async () => [{title:"Note",token:"existing-note",nodeToken:"legacy-node",url:"https://example.feishu.cn/wiki/legacy-node"}];
const legacyNote = { ...fakeNote, path: "legacy.md" };
legacyRecovery.app.vault.getMarkdownFiles = () => [legacyNote];
legacyRecovery.app.metadataCache.getFileCache = () => ({frontmatter:{lark_doc_url:"https://example.feishu.cn/wiki/legacy-node"}});
legacyRecovery.runLarkCli = async () => ({ok:true,data:{token:"existing-note"}});
await assert.rejects(legacyRecovery.recoverPreparedBindings([preparedForRecovery()], parentsForRecovery, true), /同名冲突/);
assert.deepEqual(legacyRecovery.settings.documentBindings, {});
const duplicateRemoteRecovery = createPublishingPlugin();
duplicateRemoteRecovery.listRemoteDocuments = async () => [
	{title:"Note",token:"one",url:"https://example.feishu.cn/docx/one"},
	{title:"Note",token:"two",url:"https://example.feishu.cn/docx/two"}
];
assert.deepEqual(await duplicateRemoteRecovery.recoverPreparedBindings([preparedForRecovery()],parentsForRecovery,false),{recovered:0,conflicts:1});
assert.deepEqual(duplicateRemoteRecovery.settings.documentBindings, {});

const paginatedRecoveryPlugin = createPublishingPlugin();
const listingCalls = [];
paginatedRecoveryPlugin.runLarkCli = async (args) => {
	listingCalls.push(args);
	if (args[1] === "+node-get") return {ok:true,data:{space_id:"space-one"}};
	if (!args.includes("--page-token")) return {ok:true,data:{nodes:[{obj_type:"docx",obj_token:"one",title:"One"}],has_more:true,page_token:"next"}};
	return {ok:true,data:{nodes:[{obj_type:"docx",obj_token:"two",title:"Two"}],has_more:false}};
};
assert.deepEqual((await paginatedRecoveryPlugin.listRemoteDocuments({kind:"my_library",token:"parent"})).map(x=>x.token),["one","two"]);
assert.ok(listingCalls[1].includes("space-one"));
assert.ok(listingCalls[2].includes("next"));

const uncertainCreatePlugin = createPublishingPlugin();
let uncertainCreates = 0;
uncertainCreatePlugin.runLarkCli = async () => { uncertainCreates++; throw new Error("network timeout after commit"); };
await assert.rejects(uncertainCreatePlugin.syncFileInternal(fakeNote, publishOptions), /network timeout/);
await assert.rejects(uncertainCreatePlugin.syncFileInternal(fakeNote, publishOptions), /结果尚未确认/);
assert.equal(uncertainCreates, 1);
assert.ok(uncertainCreatePlugin.settings.pendingDocumentCreates[fakeNote.path]);
const undurableCreatePlugin = createPublishingPlugin();
let undurableRemoteCalls = 0;
undurableCreatePlugin.runLarkCli = async () => { undurableRemoteCalls++; return {}; };
undurableCreatePlugin.saveData = async () => { throw new Error("disk write failed"); };
await assert.rejects(undurableCreatePlugin.syncFileInternal(fakeNote, publishOptions), /disk write failed/);
assert.equal(undurableRemoteCalls,0,"creation must wait for a durable attempt marker");

const tombstonePlugin = createPublishingPlugin();
tombstonePlugin.app.metadataCache.getFileCache = () => ({frontmatter:{lark_doc_url:canonicalBinding.url}});
await tombstonePlugin.disconnectPublishedBinding({path:fakeNote.path,kind:"markdown"});
assert.equal(tombstonePlugin.getBinding(fakeNote),null,"local disconnect suppresses stale legacy bindings without editing the note");
await tombstonePlugin.rememberDocumentBinding(fakeNote,canonicalBinding);
assert.equal(tombstonePlugin.getBinding(fakeNote).token,canonicalBinding.token);

const manualPdfPlugin = createPublishingPlugin();
manualPdfPlugin.getVaultRoot = () => "/tmp/vault";
const fakePdf = Object.assign(new globalThis.__TFileClass(), {path:"Doc.pdf",name:"Doc.pdf",extension:"pdf"});
manualPdfPlugin.app.vault.getAbstractFileByPath = () => fakePdf;
manualPdfPlugin.settings.targetTokenOrUrl = "https://example.feishu.cn/wiki/some-wiki-target";
manualPdfPlugin.runLarkCli = async () => ({ok:true,data:{type:"file",token:"existing-pdf"}});
await manualPdfPlugin.savePublishedBinding({path:"Doc.pdf",kind:"pdf"},"https://example.feishu.cn/file/existing-pdf");
assert.deepEqual(manualPdfPlugin.settings.pdfBindings["Doc.pdf"].parent,{kind:"drive",token:""});
const unsavedPdfPlugin = createPublishingPlugin();
unsavedPdfPlugin.hasUnsavedSettings = true;
unsavedPdfPlugin.saveData = async () => { throw new Error("disk still unavailable"); };
await assert.rejects(unsavedPdfPlugin.syncPdfFileUnlocked(fakePdf),/disk still unavailable/);
assert.equal(unsavedPdfPlugin.hasUnsavedSettings,true,"failed post-upload durability must be retried before reporting success");
delete globalThis.__TFileClass;

const combinedFolderPlugin = createPublishingPlugin();
const folderNote = {...fakeNote,path:"Root/Note.md"};
const folderPdf = {path:"Root/Scan.pdf",name:"Scan.pdf",extension:"pdf"};
combinedFolderPlugin.app.vault.getMarkdownFiles = () => [folderNote];
combinedFolderPlugin.app.vault.getFiles = () => [folderNote,folderPdf];
combinedFolderPlugin.withDeferredLarkSyncStateSave = async (callback) => callback();
let directoryCreates=0,noteCreates=0;
const pdfDestinations=[];
combinedFolderPlugin.runLarkCli = async (args) => {
	if (args[1] === "+node-create") { directoryCreates++; return {ok:true,data:{node_token:"root-node",url:"https://example.feishu.cn/wiki/root-node"}}; }
	if (args[1] === "+node-get") return {ok:true,data:{space_id:"my-space"}};
	if (args[1] === "+node-list") return {ok:true,data:{nodes:[],has_more:false}};
	if (args[1] === "+create") { noteCreates++; return {ok:true,data:{document:{document_id:"folder-note",url:"https://example.feishu.cn/docx/folder-note"}}}; }
	if (args[1] === "+inspect") return {ok:true,data:{token:"folder-note",type:"docx"}};
	throw new Error("Unexpected CLI command: "+args.join(" "));
};
combinedFolderPlugin.updateLarkDocument = async () => ({});
combinedFolderPlugin.syncPdfFileUnlocked = async (file,parent) => pdfDestinations.push({path:file.path,token:parent.token});
await Promise.all([combinedFolderPlugin.publishFolderInternal("Root"),combinedFolderPlugin.publishFolderInternal("Root")]);
assert.equal(directoryCreates,1);
assert.equal(noteCreates,1);
assert.deepEqual(pdfDestinations,[{path:"Root/Scan.pdf",token:"root-node"},{path:"Root/Scan.pdf",token:"root-node"}]);
const pdfOnlyPlugin = createPublishingPlugin();
pdfOnlyPlugin.app.vault.getFiles = () => [folderPdf];
pdfOnlyPlugin.withDeferredLarkSyncStateSave = async (callback) => callback();
pdfOnlyPlugin.runLarkCli = combinedFolderPlugin.runLarkCli;
let pdfOnlyUploaded=false;
pdfOnlyPlugin.syncPdfFileUnlocked = async () => {pdfOnlyUploaded=true;};
await pdfOnlyPlugin.publishFolderInternal("Root");
assert.equal(pdfOnlyUploaded,true,"PDF-only folders must create hierarchy and upload");

const pdfReferencePlugin = createPublishingPlugin();
const pdfCite = '<cite type="doc" doc-id="pdf-file" file-type="file"></cite>';
pdfReferencePlugin.settings.pdfBindings["Root/Scan.pdf"] = { status: "published", fileToken: "pdf-file" };
const pdfSource = "# Note\n\n[[Root/Scan.pdf]]\n\n![[Root/Scan.pdf#page=2]]";
pdfReferencePlugin.readNoteForLark = async () => ({ content: pdfSource, images: [] });
let firstPdfContent, firstPdfBaseline;
pdfReferencePlugin.withTempMarkdown = async (_name, content, callback) => {
	firstPdfContent = content;
	return callback({ directory: "/tmp", fileName: "note.md" });
};
pdfReferencePlugin.runLarkCli = async () => ({ok:true,data:{document:{document_id:canonicalBinding.token,url:canonicalBinding.url}}});
pdfReferencePlugin.saveCreatedDocumentStateFromBaseline = async (_binding, content) => { firstPdfBaseline = content; };
await pdfReferencePlugin.syncFileInternal(fakeNote, publishOptions);
assert.equal(firstPdfContent, `${pdfCite}\n\n${pdfCite}`, "first publish converts PDFs even outside a published folder");
assert.equal(firstPdfBaseline, `# Note\n\n${pdfCite}\n\n${pdfCite}`, "sync baseline uses the uploaded references");
let nextPdfContent;
pdfReferencePlugin.updateLarkDocument = async (_doc, prepared) => { nextPdfContent = prepared.content; return {}; };
await pdfReferencePlugin.syncFileInternal(fakeNote, { ...publishOptions, mode: "save", allowCreate: false });
assert.equal(nextPdfContent, firstPdfBaseline, "save sync preserves file references");
pdfReferencePlugin.settings.pdfBindings["Root/Scan.pdf"].status = "pending";
assert.equal(pdfReferencePlugin.rewritePublishedPdfReferences(fakeNote, pdfSource), pdfSource);
pdfReferencePlugin.settings.pdfBindings["Root/Scan.pdf"].status = "published";
pdfReferencePlugin.settings.disconnectedFolders.Root = true;
assert.equal(pdfReferencePlugin.rewritePublishedPdfReferences(fakeNote, pdfSource), pdfSource);
delete pdfReferencePlugin.settings.disconnectedFolders.Root;
pdfReferencePlugin.app.metadataCache.getFirstLinkpathDest = () => ({ path: "Unpublished/Scan.pdf" });
assert.equal(pdfReferencePlugin.rewritePublishedPdfReferences(fakeNote, "[[Scan.pdf]]"), "[[Scan.pdf]]");

const pdfFolderPlugin = createPublishingPlugin();
pdfFolderPlugin.app.vault.getMarkdownFiles = () => [folderNote];
pdfFolderPlugin.app.vault.getFiles = () => [folderNote, folderPdf];
pdfFolderPlugin.withDeferredLarkSyncStateSave = async (callback) => callback();
pdfFolderPlugin.runLarkCli = combinedFolderPlugin.runLarkCli;
pdfFolderPlugin.readNoteForLark = async () => ({ content: "# Note\n\n[[Scan.pdf]]\n\n![[Scan.pdf]]", images: [] });
const folderSequence = [];
pdfFolderPlugin.syncPdfFileUnlocked = async (file) => {
	folderSequence.push("upload");
	pdfFolderPlugin.settings.pdfBindings[file.path] = { status: "published", fileToken: "pdf-file" };
};
pdfFolderPlugin.updateLarkDocument = async (_doc, prepared) => {
	folderSequence.push("rewrite");
	assert.equal(prepared.content, `# Note\n\n${pdfCite}\n\n${pdfCite}`);
	return {};
};
await pdfFolderPlugin.publishFolderInternal("Root");
assert.deepEqual(folderSequence, ["upload", "rewrite"], "new folder references resolve after PDF bindings are durable");

const uncertainFolderPlugin = createPublishingPlugin();
let uncertainFolderCreates=0;
uncertainFolderPlugin.createRemoteFolderPage = async () => { uncertainFolderCreates++; throw new Error("folder create timeout"); };
await assert.rejects(uncertainFolderPlugin.ensureRemoteFolderPath({kind:"my_library",token:""},"Root"),/folder create timeout/);
await assert.rejects(uncertainFolderPlugin.ensureRemoteFolderPath({kind:"my_library",token:""},"Root"),/结果待确认/);
assert.equal(uncertainFolderCreates,1);

const aliasMismatchPlugin = createPublishingPlugin();
aliasMismatchPlugin.syncState.documents["https://example.feishu.cn/wiki/alias"] = {...reusableState,doc:"oldDoc"};
aliasMismatchPlugin.fetchLarkDocumentMarkdown = async () => ({doc:"newDoc",content:"# Note\n\nBody",revisionId:4});
aliasMismatchPlugin.fetchLarkDocumentWithIds = async () => ({doc:"newDoc",content:'<title id="newDoc">Note</title><p id="block-new">Body</p>',revisionId:4});
let bootstrappedCanonical;
aliasMismatchPlugin.persistDocumentState = async(state) => {bootstrappedCanonical=state;};
const canonicalBootstrap = await aliasMismatchPlugin.tryBootstrapPreciseSyncState("newDoc",["https://example.feishu.cn/wiki/alias"],"# Note\n\nBody");
assert.equal(canonicalBootstrap.doc,"newDoc");
assert.equal(bootstrappedCanonical.doc,"newDoc","bootstrap must not restore a stale alias for another document at the same revision");
console.log("main plugin tests passed");
