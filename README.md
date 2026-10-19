# Feishu Research Publisher

[简体中文](README_ZH.md)

A research-note export fork of [totok22/feishu-docs-publisher](https://github.com/totok22/feishu-docs-publisher), based on upstream 0.3.1. Publish notes to Feishu/Lark using the existing local `lark-cli` authentication and PDF publishing workflow.

**0.4.1 is a pre-release.** Native block/API and automated tests pass, but browser visual acceptance of fold/unfold behavior is still pending. See the [compatibility report](docs/native-export-v2.md) before using it with existing documents.

## Features

- Preserve the main narrative while placing Callout details in native parent/child blocks.
- Preserve nested Callouts, code blocks, source order, and initial `+`/`-` fold states.
- Use colored title rows; this does not reproduce an entire Obsidian Callout border/background.
- Retain PDF citation names, aliases, and readable page numbers; warn about unbound PDFs.
- Skip unchanged exports and retain unchanged top-level subtrees during updates.
- Journal pending writes and use idempotency keys; stop when remote content conflicts.
- Keep source Markdown read-only. Bindings and export state are stored in plugin data.

## Install

Requires desktop Obsidian **1.13.0+** and the upstream-supported `lark-cli` setup.

1. Download **main.js**, **manifest.json**, and **styles.css** from [Release 0.4.1](https://github.com/HeShiLie/feishu-docs-publisher/releases/tag/0.4.1).
2. Disable the existing plugin and back up its program files and data.
3. Copy the three files into `<vault>/.obsidian/plugins/feishu-docs-publisher/`. Preserve `data.json` and `lark-sync-state.json` if replacing upstream.
4. Restart Obsidian and enable **Feishu Research Publisher**.
5. Configure/login to `lark-cli` through the existing plugin settings. Native export additionally needs the `docx:document.block:convert` scope.

The plugin ID intentionally stays `feishu-docs-publisher` for replacement compatibility. **Do not install this fork alongside upstream.** This release is hosted on this fork; it is not a separate listing in the Obsidian community directory. Upstream updates can replace the customized files.

## Usage and limitations

Use the existing single-note publish/sync command. Publish or bind a PDF before referencing it from a note. The fork does not upload the entire Vault.

Start with a new test document. Changes within a Callout replace its containing top-level subtree; IDs/comment anchors within that changed subtree are not guaranteed to survive. Safe precise mode does not automatically migrate an existing document without native mapping.

PDF++ `![[paper.pdf#page=3&rect=x1,y1,x2,y2]]` and page embeds are rendered as images. Obsidian uses bundled PDF.js; Git-hook rendering requires Poppler. Exact text-selection navigation is not retained. The native path rejects remote image URLs and changes exceeding 1000 blocks. Native image placement has live coverage for PDF crops in lists and PNG WikiLinks inside folded parents. Mermaid, complex tables, footnotes, and HTML compatibility are not claimed complete.

See [installation, synchronization behavior, and validation details](docs/native-export-v2.md).

## Development and releases

```sh
npm ci
npm run check
npm run release:check
```

Release versions use `x.y.z`, without a `v` prefix. The Git tag, package version, manifest version, and `versions.json` entry must agree. The tag workflow tests and builds the plugin, then creates a draft release containing the three standalone plugin assets. Review that draft before publishing; use GitHub's pre-release flag while visual acceptance is pending.

## Privacy and attribution

Publishing sends the selected note and referenced resources to Feishu/Lark through the local CLI. Authentication stays with `lark-cli`; no credentials, private evaluation documents, or Vault data are included in this repository or release assets. Plugin settings hold document bindings and synchronization state. No additional analytics is introduced.

Original work: huan.wang and totok22. Research-export changes: HeShiLie. This fork retains the upstream MIT license and attribution; it is not an official Feishu/Lark or Obsidian product. See [LICENSE](LICENSE) and [CHANGELOG](CHANGELOG.md).
