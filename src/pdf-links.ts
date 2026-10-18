import { LinkContextFile, normalizeLinkPath, parentPath } from "./link-rewrite";

export interface PublishedPdfTarget {
	fileToken: string;
}

/** Obsidian's metadata resolver handles duplicate filenames and shortest links. */
export type PdfPathResolver = (target: string, sourcePath: string) => string | null;

export function buildPublishedPdfTargets(
	bindings: Record<string, { status: string; fileToken?: string }> = {},
	disconnectedFolders: Record<string, boolean> = {}
): Map<string, PublishedPdfTarget> {
	const targets = new Map<string, PublishedPdfTarget>();
	for (const [path, binding] of Object.entries(bindings)) {
		const normalized = normalizeLinkPath(path);
		const disconnected = Object.entries(disconnectedFolders).some(([folder, flag]) => {
			const prefix = normalizeLinkPath(folder);
			return flag && (normalized === prefix || normalized.startsWith(`${prefix}/`));
		});
		if (binding.status === "published" && binding.fileToken && !disconnected) {
			targets.set(normalized, { fileToken: binding.fileToken });
		}
	}
	return targets;
}

export function rewritePublishedPdfLinks(
	content: string,
	targets: Map<string, PublishedPdfTarget>,
	currentFile: LinkContextFile,
	resolvePath?: PdfPathResolver
): string {
	if (targets.size === 0 || !/\.pdf\b/i.test(content)) return content;
	// Keep examples in fenced/inline code and HTML comments as literal text.
	const protectedPattern = /^ {0,3}(`{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1`*[ \t]*(?=\r?$)|$(?![\s\S]))|^ {0,3}(~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2~*[ \t]*(?=\r?$)|$(?![\s\S]))|<!--[\s\S]*?(?:-->|$(?![\s\S]))|(`+)[\s\S]*?\3(?!`)/gm;
	let offset = 0;
	let rewritten = "";
	for (const match of content.matchAll(protectedPattern)) {
		rewritten += rewriteText(content.slice(offset, match.index), targets, currentFile, resolvePath) + match[0];
		if (match.index === undefined) continue;
		offset = match.index + match[0].length;
	}
	return rewritten + rewriteText(content.slice(offset), targets, currentFile, resolvePath);
}

function rewriteText(content: string, targets: Map<string, PublishedPdfTarget>, file: LinkContextFile, resolvePath?: PdfPathResolver): string {
	// Process both syntaxes in one pass so generated XML is never reinterpreted.
	return content.replace(/!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]|!?\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g,
		(match, wikiTarget: string | undefined, _label: string, markdownTarget: string | undefined, index: number) => {
			if (isEscaped(content, index)) return match;
			const target = decodeTarget(wikiTarget ?? markdownTarget ?? "");
			if (!target) return match;
			const path = resolvePath ? resolvePath(target, file.path) : resolveFromPublishedPaths(target, targets, file);
			const binding = path ? targets.get(normalizeLinkPath(path)) : undefined;
			if (!binding || !/^[A-Za-z0-9_-]+$/.test(binding.fileToken)) return match;
			return `<cite type="doc" doc-id="${binding.fileToken}" file-type="file"></cite>`;
		});
}

function decodeTarget(raw: string): string | null {
	let target = raw.trim().replace(/^<|>$/g, "");
	try { target = decodeURIComponent(target.split("#")[0] || ""); }
	catch { return null; }
	if (!/\.pdf$/i.test(target) || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/\\])/.test(target)) return null;
	return target.replace(/\\/g, "/");
}

function resolveFromPublishedPaths(target: string, targets: Map<string, PublishedPdfTarget>, file: LinkContextFile): string | null {
	const relative = normalizeLinkPath(`${parentPath(file.path)}/${target}`);
	const root = normalizeLinkPath(target);
	if (targets.has(relative)) return relative;
	if (targets.has(root)) return root;
	const matches = Array.from(targets.keys()).filter((path) => path.endsWith(`/${root}`));
	return matches.length === 1 ? matches[0]! : null;
}

function isEscaped(content: string, index: number): boolean {
	let count = 0;
	while (index > 0 && content[--index] === "\\") count++;
	return count % 2 === 1;
}
