import MarkdownIt from "markdown-it";

// Parse for source locations only: do not render/reformat standard Markdown.
const parser = new MarkdownIt({ html: true });
export type ExportWarning = (message: string) => void;
const icons: Record<string, string> = {
	note: "📝", tip: "💡", important: "❗", warning: "⚠️", caution: "⚠️", pdf: "📖"
};

export function normalizeObsidianCallouts(source: string, warn?: ExportWarning): string {
	const lines = source.split("\n");
	const tokens = parser.parse(source, {});
	for (let i = 0; i < tokens.length; i++) {
		const quote = tokens[i];
		const paragraph = tokens[i + 1];
		const inline = tokens[i + 2];
		if (quote?.type !== "blockquote_open" || paragraph?.type !== "paragraph_open"
			|| inline?.type !== "inline" || !inline.map) continue;
		const header = inline.content.split("\n")[0] || "";
		const match = header.match(/^\[!([\w-]+)(?:\|([^\]]+))?\]([+-])?(?:[ \t]+(.*))?$/);
		if (!match) continue;
		const type = match[1]!.toLowerCase();
		const color = match[2];
		const title = match[4]?.trim();
		const label = `${icons[type] || "📝"} ${type.toUpperCase()}${color ? ` · ${color}` : ""}`;
		const index = inline.map[0];
		const line = lines[index]!;
		// Source maps account for list nesting, quote nesting and code fences.
		const start = line.lastIndexOf(header);
		if (start < 0) continue;
		lines[index] = line.slice(0, start) + `**${label}**${title ? ` — ${title}` : ""}`;
		warn?.(`Callout ${type}: 使用引用标题降级${match[3] ? "，折叠状态无法保留" : ""}。`);
	}
	return lines.join("\n");
}

/** Transform prose only, protecting parsed code blocks and inline code/comments. */
export function transformProse(source: string, transform: (text: string) => string, protectHtml = true): string {
	const offsets = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === "\n") offsets.push(i + 1);
	const ranges: Array<[number, number]> = [];
	for (const token of parser.parse(source, {})) {
		if ((token.type === "fence" || token.type === "code_block" || (protectHtml && token.type === "html_block")) && token.map) {
			ranges.push([offsets[token.map[0]]!, offsets[token.map[1]] ?? source.length]);
		}
	}
	const inline = /<!--[\s\S]*?(?:-->|$(?![\s\S]))|(`+)[\s\S]*?\1(?!`)/g;
	for (const match of source.matchAll(inline)) ranges.push([match.index!, match.index! + match[0].length]);
	ranges.sort((a, b) => a[0] - b[0]);
	let cursor = 0;
	let result = "";
	for (const [start, end] of ranges) {
		if (end <= cursor) continue;
		if (start > cursor) result += transform(source.slice(cursor, start));
		result += source.slice(Math.max(cursor, start), end);
		cursor = end;
	}
	return result + transform(source.slice(cursor));
}
