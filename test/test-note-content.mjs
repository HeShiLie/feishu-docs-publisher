import assert from "node:assert/strict";
import esbuild from "esbuild";

await esbuild.build({
	bundle: true,
	entryPoints: ["src/note-content.ts"],
	format: "esm",
	outfile: "test/.tmp-note-content-test.mjs",
	platform: "node",
	target: "node20"
});

const { prepareNoteContentForLark } = await import("./.tmp-note-content-test.mjs");

const file = { basename: "File Name Title" };

assert.equal(
	prepareNoteContentForLark(file, "# Markdown Title\n\nBody", "file-name"),
	"# File Name Title\n\n# Markdown Title\n\nBody"
);

assert.equal(
	prepareNoteContentForLark(file, "# Markdown Title\n\nBody", "first-heading"),
	"# Markdown Title\n\n# Markdown Title\n\nBody"
);

assert.equal(
	prepareNoteContentForLark(file, "Body", "file-name"),
	"# File Name Title\n\nBody"
);

assert.equal(
	prepareNoteContentForLark(file, "Body", "first-heading"),
	"# File Name Title\n\nBody"
);

const logo = '<img src="https://example.com/logo.png" height="32" style="vertical-align: middle;" />';
assert.equal(
	prepareNoteContentForLark(file, `# ${logo} Guide\n\nBody`, "file-name"),
	`# File Name Title\n\n# Guide\n\n${logo}\n\nBody`,
	"inline HTML images must be separated so the importer preserves the heading text"
);
assert.equal(
	prepareNoteContentForLark(file, `# ${logo} Guide\n\nBody`, "first-heading"),
	`# Guide\n\n# Guide\n\n${logo}\n\nBody`,
	"the document title must use the preserved heading text"
);
for (const fence of ["```html", "~~~html"]) {
	const example = `${fence}\n# ${logo} Guide\n${fence.slice(0, 3)}`;
	assert.equal(prepareNoteContentForLark(file, example, "file-name"), `# File Name Title\n\n${example}`, "code examples must remain literal");
}
const inlineImageExample = `# Use \`${logo}\` in HTML`;
assert.equal(prepareNoteContentForLark(file, inlineImageExample, 'file-name'), `# File Name Title\n\n${inlineImageExample}`, 'inline code must remain literal');

console.log("note content tests passed");
