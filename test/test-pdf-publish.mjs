import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import esbuild from "esbuild";

const buildDirectory = await mkdtemp(join(tmpdir(), "pdf-publish-tests-"));
const moduleFile = join(buildDirectory, "pdf-publish.mjs");
await esbuild.build({
	bundle: true, entryPoints: ["src/pdf-publish.ts"], platform: "node", format: "esm",
	target: "node20", outfile: moduleFile
});
const { publishPdf, createPdfBindingKey, buildPdfUploadArgs, buildPdfWikiLookupArgs } = await import(pathToFileURL(moduleFile).href);
test.after(async () => rm(buildDirectory, { recursive: true, force: true }));

const pdf = Buffer.from("%PDF-1.4\n% synthetic public test fixture\n%%EOF\n");
const updatedPdf = Buffer.from("%PDF-1.4\n% synthetic public test fixture revision two\n%%EOF\n");

async function fixture(t, kind = "drive") {
	const root = await mkdtemp(join(tmpdir(), "pdf-fixture-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "papers"));
	const source = join(root, "papers", "Synthetic test.PDF");
	await writeFile(source, pdf);
	const options = { vaultRoot: root, vaultPath: "papers/Synthetic test.PDF", scope: "test-tenant:test-user", parent: { kind, token: "testParent" } };
	const store = new Map();
	const calls = [];
	const saves = [];
	const host = {
		async loadBinding(key) { return store.get(key); },
		async saveBinding(key, binding) {
			// JSON round-trip mimics settings serialization across plugin restarts.
			const saved = JSON.parse(JSON.stringify(binding));
			store.set(key, saved);
			saves.push(saved);
		},
		async runLarkCli(args, execution) {
			calls.push({ args, execution });
			if (args[0] === "drive") {
				assert.equal(store.get(createPdfBindingKey(options)).status, "pending");
				assert.deepEqual(await readFile(join(execution.cwd, "upload.pdf")), pdf);
				return { ok: true, data: { file_token: "testFile", url: "https://example.feishu.cn/file/testFile", version: "1" } };
			}
			return { ok: true, data: { node: { node_token: "testNode", obj_token: "testFile", obj_type: "file", node_type: "origin", parent_node_token: "testParent", url: "https://example.feishu.cn/wiki/testNode" } } };
		}
	};
	return { root, source, options, store, calls, saves, host };
}

const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test("argv uses resolved destination, explicit identity and bound overwrite token", () => {
	const args = buildPdfUploadArgs("./upload.pdf", "报告.pdf", { kind: "drive", token: "folderToken" }, "existingFile");
	assert.deepEqual(args, ["drive", "+upload", "--as", "user", "--file", "./upload.pdf", "--name", "报告.pdf", "--folder-token", "folderToken", "--file-token", "existingFile", "--json"]);
	assert.deepEqual(buildPdfUploadArgs("./upload.pdf", "报告.pdf", { kind: "wiki", token: "wikiParent" }), ["drive", "+upload", "--as", "user", "--file", "./upload.pdf", "--name", "报告.pdf", "--wiki-token", "wikiParent", "--json"]);
	assert.deepEqual(JSON.parse(buildPdfWikiLookupArgs("fileToken")[6]), { token: "fileToken", obj_type: "file" });
	assert.throws(() => buildPdfUploadArgs("f", "f.pdf", { kind: "wiki", token: "https://example/wiki/node" }), { code: "invalid-parent" });
	assert.throws(() => buildPdfUploadArgs("f", "f.pdf", { kind: "drive", token: "parent" }, ""), { code: "binding-invalid" });
	assert.deepEqual(buildPdfUploadArgs("./upload.pdf", "report.pdf", { kind: "drive", token: "" }), ["drive", "+upload", "--as", "user", "--file", "./upload.pdf", "--name", "report.pdf", "--json"]);
	assert.throws(() => buildPdfUploadArgs("f", "f.pdf", { kind: "wiki", token: "" }), { code: "invalid-parent" });
});

test("Drive upload is durable and repeat after host restart skips every CLI call", async (t) => {
	const f = await fixture(t);
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.action, "uploaded");
	assert.equal(result.binding.status, "published");
	assert.equal(result.binding.fileToken, "testFile");
	assert.equal(result.binding.contentHash, createHash("sha256").update(pdf).digest("hex"));
	assert.deepEqual(f.saves.map((b) => b.status), ["pending", "published"]);
	await assert.rejects(access(f.calls[0].execution.cwd));
	const repeated = await publishPdf(f.options, { ...f.host });
	assert.equal(repeated.action, "unchanged");
	assert.equal(f.calls.length, 1);
});

test("changed Drive PDF overwrites same file token and then skips", async (t) => {
	const f = await fixture(t);
	const initial = await publishPdf(f.options, f.host);
	await writeFile(f.source, updatedPdf);
	f.host.runLarkCli = async (args, execution) => {
		f.calls.push({ args, execution });
		assert.deepEqual(await readFile(join(execution.cwd, "upload.pdf")), updatedPdf);
		assert.equal(args[args.indexOf("--file-token") + 1], initial.binding.fileToken);
		assert.equal(f.store.get(initial.binding.key).status, "pending");
		return { code: 0, data: { file_token: "testFile", version: 2 } };
	};
	const changed = await publishPdf(f.options, f.host);
	assert.equal(changed.action, "updated");
	assert.equal(changed.binding.fileToken, initial.binding.fileToken);
	assert.equal(changed.binding.remoteVersion, "2");
	assert.equal(changed.binding.url, initial.binding.url);
	assert.notEqual(changed.binding.contentHash, initial.binding.contentHash);
	assert.equal((await publishPdf(f.options, f.host)).action, "unchanged");
	assert.equal(f.calls.length, 2);
});

test("unexpected replacement token is never silently adopted or uploaded again", async (t) => {
	const f = await fixture(t);
	const first = await publishPdf(f.options, f.host);
	await writeFile(f.source, updatedPdf);
	f.host.runLarkCli = async () => ({ ok: true, data: { file_token: "unexpectedNewFile" } });
	await rejectsCode(publishPdf(f.options, f.host), "replacement-unsupported");
	const saved = f.store.get(first.binding.key);
	assert.equal(saved.fileToken, "testFile");
	assert.equal(saved.unexpectedFileToken, "unexpectedNewFile");
	assert.equal(saved.status, "pending");
	f.host.runLarkCli = async () => assert.fail("Must not retry an uncertain overwrite");
	await rejectsCode(publishPdf(f.options, f.host), "upload-uncertain");
});

test("native wiki upload records its file token before lookup and verifies parent", async (t) => {
	const f = await fixture(t, "wiki");
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.binding.nodeToken, "testNode");
	assert.equal(result.binding.url, "https://example.feishu.cn/wiki/testNode");
	assert.deepEqual(f.saves.map((b) => b.status), ["pending", "uploaded", "published"]);
	assert.equal(f.calls.length, 2);
	assert.equal(f.calls[0].args[f.calls[0].args.indexOf("--wiki-token") + 1], "testParent");
	assert.equal((await publishPdf(f.options, f.host)).action, "unchanged");
	assert.equal(f.calls.length, 2);
});

test("failed wiki lookup resumes only the read using the durable file token", async (t) => {
	const f = await fixture(t, "wiki");
	const original = f.host.runLarkCli;
	f.host.runLarkCli = async (args, execution) => {
		if (args[0] === "wiki") throw new Error("temporary lookup failure");
		return original(args, execution);
	};
	await rejectsCode(publishPdf(f.options, f.host), "wiki-file-unverified");
	assert.equal(f.store.get(createPdfBindingKey(f.options)).status, "uploaded");
	f.host.runLarkCli = async (args, execution) => {
		assert.equal(args[0], "wiki");
		return original(args, execution);
	};
	assert.equal((await publishPdf(f.options, { ...f.host })).action, "recovered");
	assert.equal(f.calls.filter((c) => c.args[0] === "drive").length, 1);
});

test("wrong wiki parent/type/object/node kind blocks completion without reupload", async (t) => {
	for (const patch of [{ parent_node_token: "otherParent" }, { obj_type: "docx" }, { obj_token: "otherFile" }, { node_type: "shortcut" }]) {
		const f = await fixture(t, "wiki");
		const original = f.host.runLarkCli;
		f.host.runLarkCli = async (args, execution) => {
			const response = await original(args, execution);
			if (args[0] === "wiki") Object.assign(response.data.node, patch);
			return response;
		};
		await rejectsCode(publishPdf(f.options, f.host), "wiki-file-unverified");
		await rejectsCode(publishPdf(f.options, f.host), "wiki-file-unverified");
		assert.equal(f.calls.filter((c) => c.args[0] === "drive").length, 1);
	}
});

test("changed wiki PDF uses original file and preserves native node", async (t) => {
	const f = await fixture(t, "wiki");
	const initial = await publishPdf(f.options, f.host);
	await writeFile(f.source, updatedPdf);
	const original = f.host.runLarkCli;
	f.host.runLarkCli = async (args, execution) => {
		if (args[0] === "wiki") return original(args, execution);
		f.calls.push({ args, execution });
		assert.equal(args[args.indexOf("--file-token") + 1], "testFile");
		return { ok: true, data: { file_token: "testFile", version: "2" } };
	};
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.action, "updated");
	assert.equal(result.binding.fileToken, initial.binding.fileToken);
	assert.equal(result.binding.nodeToken, initial.binding.nodeToken);
});

test("concurrent same-PDF calls serialize and create only one file", async (t) => {
	const f = await fixture(t);
	const results = await Promise.all(Array.from({ length: 6 }, () => publishPdf(f.options, f.host)));
	assert.equal(f.calls.length, 1);
	assert.deepEqual(results.map((r) => r.action), ["uploaded", ...Array(5).fill("unchanged")]);
});

test("new upload result errors leave a pending binding and prevent blind retries", async (t) => {
	for (const response of [{ ok: false, error: { message: "forbidden" } }, { ok: true, data: {} }, { code: 1061001, data: { file_token: "notCommitted" } }, { ok: true, dry_run: true, data: { file_token: "notCommitted" } }, "invalid json"]) {
		const f = await fixture(t);
		let count = 0;
		f.host.runLarkCli = async () => { count++; return response; };
		await rejectsCode(publishPdf(f.options, f.host), "upload-uncertain");
		await rejectsCode(publishPdf(f.options, { ...f.host }), "upload-uncertain");
		assert.equal(count, 1);
	}
});

test("network failure retains uncertainty and cleans the temporary snapshot", async (t) => {
	const f = await fixture(t);
	let directory;
	f.host.runLarkCli = async (_args, options) => { directory = options.cwd; throw new Error("response lost"); };
	await rejectsCode(publishPdf(f.options, f.host), "upload-uncertain");
	await assert.rejects(access(directory));
	await rejectsCode(publishPdf(f.options, f.host), "upload-uncertain");
});

test("durable pending save is mandatory before the upload", async (t) => {
	const f = await fixture(t);
	f.host.saveBinding = async () => { throw new Error("disk full"); };
	await rejectsCode(publishPdf(f.options, f.host), "binding-save-failed");
	assert.equal(f.calls.length, 0);
});

test("post-upload persistence failure exposes token and retains pending guard", async (t) => {
	const f = await fixture(t);
	const save = f.host.saveBinding;
	f.host.saveBinding = async (key, binding) => {
		if (binding.status === "published") throw new Error("disk full");
		await save(key, binding);
	};
	await assert.rejects(publishPdf(f.options, f.host), (e) => e.code === "binding-save-failed" && e.binding.fileToken === "testFile");
	await rejectsCode(publishPdf(f.options, f.host), "upload-uncertain");
	assert.equal(f.calls.length, 1);
});

test("corrupt/mismatched bindings never permit creation", async (t) => {
	const f = await fixture(t);
	const first = await publishPdf(f.options, f.host);
	for (const patch of [{ key: "wrong" }, { fileToken: "" }, { contentHash: "bad" }, { parent: { kind: "drive", token: "other" } }, { scope: "other-user" }, { size: -1 }, { status: "bogus" }]) {
		f.store.set(first.binding.key, { ...first.binding, ...patch });
		await rejectsCode(publishPdf(f.options, f.host), "binding-invalid");
	}
	assert.equal(f.calls.length, 1);
});

test("scope, vault, destination, and local path isolate binding keys", async (t) => {
	const f = await fixture(t);
	const original = createPdfBindingKey(f.options);
	for (const patch of [{ scope: "other-tenant:user" }, { vaultRoot: join(f.root, "other") }, { vaultPath: "other.pdf" }, { parent: { kind: "wiki", token: "testParent" } }, { parent: { kind: "drive", token: "otherParent" } }]) {
		assert.notEqual(original, createPdfBindingKey({ ...f.options, ...patch }));
	}
	assert.equal(original, createPdfBindingKey({ ...f.options, vaultPath: "papers\\Synthetic test.PDF" }));
	assert.throws(() => createPdfBindingKey({ ...f.options, scope: " " }), { code: "invalid-scope" });
});

test("invalid header, non-PDF, absolute/traversal/symlink paths fail before saving", async (t) => {
	const f = await fixture(t);
	await writeFile(f.source, "not a PDF");
	await rejectsCode(publishPdf(f.options, f.host), "invalid-pdf");
	await rejectsCode(publishPdf({ ...f.options, vaultPath: "papers/note.md" }, f.host), "invalid-pdf");
	for (const vaultPath of [f.source, "../outside.pdf", "C:\\outside.pdf"]) {
		await rejectsCode(publishPdf({ ...f.options, vaultPath }, f.host), "pdf-outside-vault");
	}
	const outside = join(dirname(f.root), `outside-${basenameSafe(f.root)}.pdf`);
	t.after(async () => rm(outside, { force: true }));
	await writeFile(outside, pdf);
	await symlink(outside, join(f.root, "link.pdf"));
	await rejectsCode(publishPdf({ ...f.options, vaultPath: "link.pdf" }, f.host), "pdf-outside-vault");
	assert.equal(f.saves.length, 0);
	assert.equal(f.calls.length, 0);
});

test("source changes after snapshot creation do not corrupt recorded uploaded hash", async (t) => {
	const f = await fixture(t);
	const original = f.host.runLarkCli;
	f.host.runLarkCli = async (args, options) => {
		await writeFile(f.source, updatedPdf);
		return original(args, options);
	};
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.binding.contentHash, createHash("sha256").update(pdf).digest("hex"));
});

function basenameSafe(path) { return path.split(/[\\/]/).at(-1); }

test("Drive root uploads omit folder token", async (t) => {
	const f = await fixture(t);
	f.options.parent.token = "";
	await publishPdf(f.options, f.host);
	assert.equal(f.calls[0].args.includes("--folder-token"), false);
});

test("manual binding sentinel forces first overwrite of the inspected token", async (t) => {
	const f = await fixture(t);
	const initial = await publishPdf(f.options, f.host);
	f.store.set(initial.binding.key, { ...initial.binding, contentHash: "0".repeat(64), size: 5 });
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.action, "updated");
	assert.equal(f.calls[1].args[f.calls[1].args.indexOf("--file-token") + 1], initial.binding.fileToken);
	assert.equal(result.binding.fileToken, initial.binding.fileToken);
});

test("rename binding migration changes key/path while retaining remote name and token", async (t) => {
	const f = await fixture(t);
	const initial = await publishPdf(f.options, f.host);
	const renamedOptions = { ...f.options, vaultPath: "papers/Renamed.pdf" };
	await writeFile(join(f.root, renamedOptions.vaultPath), pdf);
	const newKey = createPdfBindingKey(renamedOptions);
	f.store.set(newKey, { ...initial.binding, key: newKey, vaultPath: renamedOptions.vaultPath });
	f.store.delete(initial.binding.key);
	const result = await publishPdf(renamedOptions, f.host);
	assert.equal(result.action, "unchanged");
	assert.equal(result.binding.fileToken, initial.binding.fileToken);
	assert.equal(result.binding.fileName, initial.binding.fileName);
	assert.equal(f.calls.length, 1);
});

test("file-token-only upload succeeds and recovers canonical URL via inspect", async (t) => {
	const f = await fixture(t);
	f.host.runLarkCli = async (args, execution) => {
		f.calls.push({ args, execution });
		if (args[1] === "+upload") return { ok: true, data: { file_token: "testFile" } };
		assert.deepEqual(args, ["drive", "+inspect", "--as", "user", "--url", "testFile", "--type", "file", "--json"]);
		assert.equal(f.store.get(createPdfBindingKey(f.options)).fileToken, "testFile");
		return { ok: true, data: { type: "file", token: "testFile", url: "https://example.feishu.cn/file/testFile" } };
	};
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.binding.url, "https://example.feishu.cn/file/testFile");
	assert.equal(f.calls.length, 2);
	await publishPdf(f.options, f.host);
	assert.equal(f.calls.length, 2);
});

test("metadata failure or mismatched token cannot trigger duplicate file uploads", async (t) => {
	const f = await fixture(t);
	let uploads = 0;
	f.host.runLarkCli = async (args) => {
		if (args[1] === "+upload") { uploads++; return { ok: true, data: { file_token: "testFile" } }; }
		return { ok: true, data: { type: "file", token: "wrongFile", url: "https://example.feishu.cn/file/wrongFile" } };
	};
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.binding.status, "published");
	assert.equal(result.binding.url, undefined);
	assert.equal((await publishPdf(f.options, f.host)).action, "unchanged");
	assert.equal(uploads, 1);
});

test("wiki replacement cannot silently change the native node token", async (t) => {
	const f = await fixture(t, "wiki");
	await publishPdf(f.options, f.host);
	await writeFile(f.source, updatedPdf);
	f.host.runLarkCli = async (args) => args[0] === "drive"
		? { ok: true, data: { file_token: "testFile" } }
		: { ok: true, data: { node: { node_token: "unexpectedNewNode", obj_token: "testFile", obj_type: "file", node_type: "origin", parent_node_token: "testParent" } } };
	await rejectsCode(publishPdf(f.options, f.host), "wiki-file-unverified");
	assert.equal(f.store.get(createPdfBindingKey(f.options)).nodeToken, "testNode");
});

test("caller canonical URL fallback supports Lark when metadata is unavailable", async (t) => {
	const f = await fixture(t);
	let uploads = 0;
	f.host.runLarkCli = async (args) => {
		if (args[1] === "+upload") { uploads++; return { ok: true, data: { file_token: "testFile" } }; }
		throw new Error("metadata scope missing");
	};
	f.host.resolveCanonicalUrl = (binding) => `https://test.larksuite.com/file/${binding.fileToken}`;
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.binding.url, "https://test.larksuite.com/file/testFile");
	await publishPdf(f.options, f.host);
	assert.equal(uploads, 1);
});

test("manual wiki binding without node token verifies before first overwrite", async (t) => {
	const f = await fixture(t, "wiki");
	const first = await publishPdf(f.options, f.host);
	f.store.set(first.binding.key, { ...first.binding, nodeToken: undefined, contentHash: "0".repeat(64), size: 5 });
	f.calls.length = 0;
	const result = await publishPdf(f.options, f.host);
	assert.equal(result.action, "updated");
	assert.equal(result.binding.fileToken, first.binding.fileToken);
	assert.equal(result.binding.nodeToken, "testNode");
	assert.deepEqual(f.calls.map((c) => c.args[0]), ["wiki", "drive", "wiki"]);
});

test("changed PDF after wiki lookup failure verifies old file before overwriting", async (t) => {
	const f = await fixture(t, "wiki");
	const original = f.host.runLarkCli;
	f.host.runLarkCli = async (args, execution) => {
		if (args[0] === "wiki") throw new Error("lookup unavailable");
		return original(args, execution);
	};
	await rejectsCode(publishPdf(f.options, f.host), "wiki-file-unverified");
	await writeFile(f.source, updatedPdf);
	f.calls.length = 0;
	f.host.runLarkCli = async (args, execution) => {
		if (args[0] === "wiki") return original(args, execution);
		f.calls.push({ args, execution });
		assert.equal(args[args.indexOf("--file-token") + 1], "testFile");
		return { ok: true, data: { file_token: "testFile", version: "2" } };
	};
	assert.equal((await publishPdf(f.options, f.host)).action, "updated");
	assert.deepEqual(f.calls.map((c) => c.args[0]), ["wiki", "drive", "wiki"]);
});
