import { createHash } from "crypto";
import { createReadStream } from "fs";
import { copyFile, mkdtemp, open, realpath, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { basename, isAbsolute, join, posix, relative, resolve, sep, win32 } from "path";

export interface PdfPublishParent {
	kind: "drive" | "wiki";
	/** Resolved folder/wiki parent node token; empty Drive token means user root. */
	token: string;
}

export interface PdfPublishOptions {
	vaultRoot: string;
	vaultPath: string;
	parent: PdfPublishParent;
	/** Stable namespace for the CLI profile, tenant and user. Change it when identity changes. */
	scope: string;
	/** Explicit overwrite refreshes even when the local hash is unchanged. */
	force?: boolean;
}

export interface PdfBinding {
	version: 1;
	key: string;
	vaultPath: string;
	parent: PdfPublishParent;
	scope: string;
	fileName: string;
	contentHash: string;
	size: number;
	/** pending means an upload may have committed without its token being recorded. */
	status: "pending" | "uploaded" | "published";
	fileToken?: string;
	/** Returned upload version when supported by the tenant. */
	remoteVersion?: string;
	/** Unexpected replacement token retained for manual reconciliation, never adopted. */
	unexpectedFileToken?: string;
	nodeToken?: string;
	url?: string;
	updatedAt: string;
}

export interface PdfPublishHost {
	loadBinding(key: string): Promise<unknown>;
	/** Must durably save before resolving; do not evict PDF bindings with document caches. */
	saveBinding(key: string, binding: PdfBinding): Promise<void>;
	/** Execute argv without a shell and without automatic retries of upload commands. */
	runLarkCli(args: string[], options?: { cwd?: string }): Promise<unknown>;
	/** Optional fallback using the caller's observed tenant/brand URL; never guess Feishu vs Lark. */
	resolveCanonicalUrl?(binding: PdfBinding): string | undefined | Promise<string | undefined>;
}

export interface PdfPublishResult {
	action: "uploaded" | "updated" | "unchanged" | "recovered";
	binding: PdfBinding;
}

export type PdfPublishErrorCode =
	| "invalid-pdf" | "pdf-outside-vault" | "invalid-parent" | "invalid-scope"
	| "binding-invalid" | "binding-save-failed" | "upload-uncertain"
	| "replacement-unsupported" | "wiki-file-unverified";

export class PdfPublishError extends Error {
	constructor(
		public readonly code: PdfPublishErrorCode,
		message: string,
		public readonly binding?: PdfBinding,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = "PdfPublishError";
	}
}

// Validated with installed CLI 1.0.96 help/dry runs. Native wiki uploads are
// verified by get_node; replacements must return the original file_token.
// Never fall back to a new upload or delete the previous remote file.
export function buildPdfUploadArgs(filePath: string, fileName: string, parent: PdfPublishParent, fileToken?: string): string[] {
	validateParent(parent);
	if (fileToken !== undefined && !isToken(fileToken)) {
		throw new PdfPublishError("binding-invalid", "Replacement requires a valid bound file token.");
	}
	const args = [
		"drive", "+upload", "--as", "user", "--file", filePath, "--name", fileName
	];
	if (parent.token) {
		args.push(parent.kind === "wiki" ? "--wiki-token" : "--folder-token", parent.token);
	}
	if (fileToken !== undefined) {
		args.push("--file-token", fileToken);
	}
	return [...args, "--json"];
}

export function buildPdfWikiLookupArgs(fileToken: string): string[] {
	if (!isToken(fileToken)) {
		throw new PdfPublishError("wiki-file-unverified", "A valid uploaded file token is required.");
	}
	// The typed API supports an explicit file obj_type and has an installed schema.
	return [
		"wiki", "spaces", "get_node", "--as", "user", "--params",
		JSON.stringify({ token: fileToken, obj_type: "file" }), "--json"
	];
}

export function buildPdfInspectArgs(fileToken: string): string[] {
	if (!isToken(fileToken)) {
		throw new PdfPublishError("binding-invalid", "A valid uploaded file token is required.");
	}
	return ["drive", "+inspect", "--as", "user", "--url", fileToken, "--type", "file", "--json"];
}

export function createPdfBindingKey(options: PdfPublishOptions): string {
	validateParent(options.parent);
	if (!options.scope.trim()) {
		throw new PdfPublishError("invalid-scope", "A stable CLI identity scope is required for PDF bindings.");
	}
	return `pdf:v1:${createHash("sha256").update(JSON.stringify([
		options.scope, resolve(options.vaultRoot), normalizeVaultPath(options.vaultPath),
		options.parent.kind, options.parent.token
	])).digest("hex")}`;
}

const hostLocks = new WeakMap<PdfPublishHost, Map<string, Promise<void>>>();

/**
 * Reuse one host per plugin/store to serialize concurrent uploads of the same PDF.
 * Across processes, the caller must additionally lock the binding store. Local
 * renames must migrate the binding key; deleting a binding permits a new upload.
 * Reconcile pending bindings manually with the remote token; never auto-clear them.
 * Returns only after the binding is durable. No remote writes run on unchanged PDFs.
 * Binding fileName is the remote name and may differ from a renamed local path.
 */
export async function publishPdf(options: PdfPublishOptions, host: PdfPublishHost): Promise<PdfPublishResult> {
	// Capture caller-owned inputs before awaiting anything.
	const input = { ...options, parent: { ...options.parent }, vaultPath: normalizeVaultPath(options.vaultPath) };
	const key = createPdfBindingKey(input);
	let locks = hostLocks.get(host);
	if (!locks) {
		locks = new Map();
		hostLocks.set(host, locks);
	}
	const preceding = locks.get(key) || Promise.resolve();
	let release!: () => void;
	const done = new Promise<void>((resolveDone) => { release = resolveDone; });
	locks.set(key, done);
	await preceding;
	try {
		return await publishLocked(input, key, host);
	} finally {
		release();
		if (locks.get(key) === done) {
			locks.delete(key);
		}
	}
}

async function publishLocked(options: PdfPublishOptions, key: string, host: PdfPublishHost): Promise<PdfPublishResult> {
	const loaded = await host.loadBinding(key);
	let binding = loaded == null ? undefined : validateBinding(loaded, options, key);
	if (binding?.status === "pending") {
		throw new PdfPublishError("upload-uncertain",
			"A previous PDF upload may have succeeded. Reconcile its remote token before retrying; no new file was uploaded.", binding);
	}

	const root = await realpath(options.vaultRoot);
	const source = await realpath(resolve(root, options.vaultPath));
	if (!isInside(root, source)) {
		throw new PdfPublishError("pdf-outside-vault", "PDF resolves outside the vault.");
	}
	if (!(await stat(source)).isFile()) {
		throw new PdfPublishError("invalid-pdf", "PDF source must be a regular file.");
	}
	const directory = await mkdtemp(join(tmpdir(), "feishu-pdf-"));
	try {
		// Hash and upload the same snapshot even if Obsidian rewrites the source.
		const snapshot = join(directory, "upload.pdf");
		await copyFile(source, snapshot);
		const file = await open(snapshot, "r");
		try {
			const header = Buffer.alloc(5);
			await file.read(header, 0, 5, 0);
			if (header.toString("ascii") !== "%PDF-") {
				throw new PdfPublishError("invalid-pdf", "PDF source is missing the %PDF- header.");
			}
		} finally {
			await file.close();
		}
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(snapshot)) {
			hash.update(chunk);
		}
		const contentHash = hash.digest("hex");
		const size = (await stat(snapshot)).size;
		const changed = Boolean(binding && (options.force || binding.contentHash !== contentHash || binding.size !== size));
		if (changed && binding?.status === "uploaded") {
			// A prior lookup failure or a manual bind may lack the wiki node token.
			// Verify the saved remote file before overwriting its changed local copy.
			binding = await verifyWikiBinding(binding, host);
		}
		if (binding?.status === "published" && !changed) {
			binding = await recoverUrl(binding, host);
			return { action: "unchanged", binding };
		}

		const recovering = Boolean(binding);
		if (!binding || changed) {
			const previousToken = binding?.fileToken;
			binding = binding ? {
				...binding, contentHash, size, status: "pending", updatedAt: new Date().toISOString()
			} : {
				version: 1, key, scope: options.scope, vaultPath: options.vaultPath,
				parent: { ...options.parent }, fileName: basename(options.vaultPath),
				contentHash, size, status: "pending", updatedAt: new Date().toISOString()
			};
			await saveBinding(host, binding);
			let data: Record<string, unknown>;
			try {
				data = responseData(await host.runLarkCli(buildPdfUploadArgs("./upload.pdf", binding.fileName, options.parent, previousToken), { cwd: directory }));
				if (!isToken(data.file_token)) {
					throw new Error("Upload response has no valid file_token.");
				}
			} catch (error) {
				throw new PdfPublishError("upload-uncertain",
					"PDF upload failed or its result is uncertain. The pending binding was retained; reconcile it before retrying.", binding, error);
			}
			if (previousToken && data.file_token !== previousToken) {
				binding = { ...binding, unexpectedFileToken: data.file_token as string };
				await saveBinding(host, binding);
				throw new PdfPublishError("replacement-unsupported",
					"The server did not preserve the bound PDF token during replacement. The original binding was retained; reconcile the unexpected token before retrying.", binding);
			}
			binding = {
				...binding, status: options.parent.kind === "wiki" ? "uploaded" : "published",
				fileToken: data.file_token as string, url: readUrl(data.url) || binding.url,
				remoteVersion: readVersion(data.version) || binding.remoteVersion, updatedAt: new Date().toISOString()
			};
			// Persist the file token BEFORE attempting wiki resolution so lookup failures
			// can resume without repeating the write.
			await saveBinding(host, binding);
		}
		if (options.parent.kind === "wiki") {
			binding = await verifyWikiBinding(binding, host);
		}
		binding = await recoverUrl(binding, host);
		return { action: changed ? "updated" : recovering ? "recovered" : "uploaded", binding };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function verifyWikiBinding(binding: PdfBinding, host: PdfPublishHost): Promise<PdfBinding> {
	let node: Record<string, unknown>;
	try {
		const data = responseData(await host.runLarkCli(buildPdfWikiLookupArgs(binding.fileToken!)));
		node = isRecord(data.node) ? data.node : data;
		if (node.obj_type !== "file" || node.node_type !== "origin"
			|| node.obj_token !== binding.fileToken || !isToken(node.node_token)
			|| (binding.nodeToken !== undefined && node.node_token !== binding.nodeToken)
			|| node.parent_node_token !== binding.parent.token) {
			throw new Error("Uploaded file is not an origin wiki file node under the requested parent.");
		}
	} catch (error) {
		throw new PdfPublishError("wiki-file-unverified",
			"The saved PDF's native wiki file node could not be verified. Its token was retained; the next retry verifies that token before writing.", binding, error);
	}
	const verified: PdfBinding = { ...binding, status: "published", nodeToken: node.node_token as string,
		url: readUrl(node.url) || binding.url, updatedAt: new Date().toISOString() };
	await saveBinding(host, verified);
	return verified;
}

async function recoverUrl(binding: PdfBinding, host: PdfPublishHost): Promise<PdfBinding> {
	if (binding.url) {
		return binding;
	}
	let url: string | undefined;
	try {
		const data = responseData(await host.runLarkCli(buildPdfInspectArgs(binding.fileToken!)));
		// Metadata/URL recovery is read-only and best effort. Never lose the durable
		// file binding or retry an upload when metadata permissions are unavailable.
		if (data.type === "file" && data.token === binding.fileToken) {
			url = readUrl(data.url);
		}
	} catch {
		// The caller can still recover a URL from its resolved parent/tenant origin.
	}
	if (!url && host.resolveCanonicalUrl) {
		try {
			url = readUrl(await host.resolveCanonicalUrl(binding));
		} catch {
			// A metadata failure must never turn into a second upload.
		}
	}
	if (!url) {
		return binding;
	}
	const resolved = { ...binding, url };
	await saveBinding(host, resolved);
	return resolved;
}

async function saveBinding(host: PdfPublishHost, binding: PdfBinding): Promise<void> {
	try {
		await host.saveBinding(binding.key, binding);
	} catch (error) {
		throw new PdfPublishError("binding-save-failed",
			"Could not durably save the PDF binding. Preserve this binding for recovery before retrying.", binding, error);
	}
}

function validateBinding(value: unknown, options: PdfPublishOptions, key: string): PdfBinding {
	if (!isRecord(value) || value.version !== 1 || value.key !== key
		|| value.scope !== options.scope || value.vaultPath !== options.vaultPath
		|| !isRecord(value.parent) || value.parent.kind !== options.parent.kind || value.parent.token !== options.parent.token
		|| typeof value.fileName !== "string" || !/\.pdf$/i.test(value.fileName)
		|| value.fileName.length > 250 || /[\\/\0]/.test(value.fileName) || typeof value.contentHash !== "string"
		|| !/^[a-f0-9]{64}$/.test(value.contentHash) || typeof value.size !== "number"
		|| !Number.isSafeInteger(value.size) || value.size < 5 || typeof value.updatedAt !== "string"
		|| !["pending", "uploaded", "published"].includes(String(value.status))
		|| (value.status !== "pending" && !isToken(value.fileToken))
		|| (value.nodeToken !== undefined && !isToken(value.nodeToken))
		|| (value.url !== undefined && readUrl(value.url) !== value.url)) {
		throw new PdfPublishError("binding-invalid", "Invalid or mismatched PDF binding; reconcile it before uploading.");
	}
	const binding = value as unknown as PdfBinding;
	// Manual binding by file token may not know the native wiki node yet. Treat it
	// as unverified and resolve it read-only before any overwrite.
	return binding.parent.kind === "wiki" && binding.status === "published" && !binding.nodeToken
		? { ...binding, status: "uploaded" } : binding;
}

function responseData(value: unknown): Record<string, unknown> {
	const response: unknown = typeof value === "string" ? JSON.parse(value) : value;
	if (!isRecord(response) || response.dry_run === true || response.ok === false
		|| (response.code !== undefined && response.code !== 0)
		|| (response.ok !== true && response.code !== 0) || !isRecord(response.data)) {
		throw new Error("lark-cli returned an unsuccessful or invalid response.");
	}
	return response.data;
}

function normalizeVaultPath(path: string): string {
	const normalized = posix.normalize(path.replace(/\\/g, "/"));
	if (isAbsolute(path) || win32.isAbsolute(path) || normalized === ".." || normalized.startsWith("../")) {
		throw new PdfPublishError("pdf-outside-vault", "PDF path must be relative to the vault.");
	}
	if (!/\.pdf$/i.test(normalized)) {
		throw new PdfPublishError("invalid-pdf", "Only .pdf files can be published as PDFs.");
	}
	return normalized;
}

function validateParent(parent: PdfPublishParent): void {
	if ((parent.kind !== "drive" && parent.kind !== "wiki")
		|| (!isToken(parent.token) && !(parent.kind === "drive" && parent.token === ""))) {
		throw new PdfPublishError("invalid-parent", "PDF uploads require a resolved Drive folder or wiki parent node token.");
	}
}

function isInside(root: string, file: string): boolean {
	const path = relative(root, file);
	return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isToken(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUrl(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password ? value : undefined;
	} catch {
		return undefined;
	}
}

function readVersion(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value
		: typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
