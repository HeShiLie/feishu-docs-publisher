import { existsSync, readFileSync } from "node:fs";

function fail(message) {
	console.error(`Release check failed: ${message}`);
	process.exit(1);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const version = packageJson.version;
const releaseTag = (process.env.RELEASE_TAG || "").trim();

if (manifest.version !== version) {
	fail(`manifest.json version ${manifest.version} does not match package.json version ${version}`);
}

if (releaseTag && releaseTag !== version) {
	fail(`tag ${releaseTag} does not match package.json version ${version}`);
}

if (!versions[version]) {
	fail(`versions.json does not contain ${version}`);
}

const notesPath = `release-notes/${version}.md`;
if (!existsSync(notesPath)) {
	fail(`missing ${notesPath}; add curated release notes before tagging`);
}

const notes = readFileSync(notesPath, "utf8").trim();
if (!notes.startsWith(`# ${version}`)) {
	fail(`${notesPath} must start with "# ${version}"`);
}

const changelogPath = "CHANGELOG.md";
if (!existsSync(changelogPath)) {
	fail("missing CHANGELOG.md");
}
const changelog = readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (!new RegExp(`^## \\[${escapedVersion}\\]`, "m").test(changelog)) {
	fail(`CHANGELOG.md has no "## [${version}]" section`);
}

console.log(`Release metadata OK: ${version} (${notesPath})`);
