# Changelog

本项目从 `0.1.26` 继续开发并更名为 **Feishu Docs Publisher**。更早版本的逐版说明保存在 [`release-notes/`](./release-notes/) 和 Git 历史中。

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构维护，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.4.2] - 2026-10-19

### Changed

- Render explicit bold labels immediately before Chinese/English colons with bright yellow backgrounds and red text in native research exports. Preserve bold and other inline styles; leave code and unrelated bold text unchanged.

## [0.4.1] - 2026-10-19

### Fixed

- Render PDF++ page/rect image embeds instead of silently replacing them with file citations.
- Preserve local WikiLink image placement inside Callouts and lists; protect fenced and inline code examples.
- Create native image blocks directly at their target positions and persist upload tokens for retry.
- Add PDF crop dimensions/cache tests and nested native image recovery coverage.

### Notes

- Obsidian uses its bundled PDF.js renderer. Git-hook PDF rendering requires Poppler; rotated PDFs should be published inside Obsidian.
- Live tests confirmed two PDF crop images in their source section and an ordinary PNG WikiLink inside a folded parent. General visual fold/unfold acceptance remains pending.

## [0.4.0] - 2026-10-19

### Added

- Native parent/child Callout export for research notes, with default fold states and colored title rows.
- Resumable native subtree synchronization, idempotent creation, and remote-edit protection.
- PDF citation labels, page numbers, and explicit unresolved-attachment fallback.
- Automated parser, synchronization, media-mapping, and plugin-routing tests.

### Changed

- Research fork maintained by HeShiLie; original MIT attribution retained.
- Source Markdown stays read-only, including binding and remote-deletion handling.

### Known limitations

- Pre-release: browser visual folding acceptance remains pending.
- PDF crop images and exact selection navigation are not implemented.
- Native export rejects network images and changes larger than 1000 blocks; local-image-in-Callout end-to-end coverage remains incomplete.

## [0.3.1] - 2026-10-18

### 变更

- 设置页迁移到 Obsidian 1.13 的声明式设置 API，所有设置项现在可被设置搜索找到；最低 Obsidian 版本同步提升到 1.13.0。

### 修复

- 修复 Obsidian 插件审查发现的直接样式赋值、不必要类型断言、异步回调签名、未使用代码和废弃按钮 API。

## [0.3.0] - 2026-10-18

### 新增

- 在插件设置的「CLI 与授权」中安装或升级 `lark-cli`，查看当前版本、最新版本和登录状态，不需要在终端安装依赖。
- 在浏览器中创建飞书或 Lark CLI 应用，并支持登录、重新授权和退出登录；进行中的授权操作可以取消。
- 缺少 npm 时提供 Node.js 下载入口，安装后可在设置页重新检测。
- 新增「网络代理」设置，可选择继承系统环境变量、使用自定义 HTTP 代理或关闭代理。该策略也会应用到 Git `pre-push` 同步。

### 修复

- 重新绑定已断开的子目录时，同时清除覆盖它的父目录断开标记，避免子目录继续被隐藏。
- 绑定的远端 PDF 被删除或移动到其他目录后，重新上传并刷新绑定，不再误判为内容未变化。
- 安装脚本补充指向插件内 CLI 配置流程的提示。

## [0.2.1] - 2026-10-18

### 变更

- 将 README 中的仓库地址更新为 `feishu-docs-publisher`。
- 发布标签与 `package.json`、`manifest.json`、`versions.json` 中的版本保持一致。

## [0.2.0] - 2026-10-15

### 新增

- 以 **Feishu Docs Publisher** 和新插件 ID `feishu-docs-publisher` 重新发布。
- 首次启动时从旧的 `feishu-lark-cli-sync` 插件目录迁移 `data.json` 和 `lark-sync-state.json`，旧目录保持不变。
- 新增已发布文件管理窗口和侧边栏入口，可复制链接、打开本地或远端文件、同步、设置链接和移除记录。
- 支持 PDF 上传、持久绑定、原生文件链接改写，以及覆盖同步时的重复文件清理。
- Wiki 目录文档支持飞书原生子页面列表；目录绑定支持嵌套记录和已发布文件折叠。
- 显式覆盖会复用固定目标并检查绑定冲突，避免同一个远端文件被多个本地文件绑定。

### 修复

- 处理旧版 Wiki 文档的 owner 解析、标题附近的导入图片、飞书引用块和 URL 往返格式。
- 完善目录发布、PDF 引用和 pre-push 同步中的去重与绑定恢复。

[0.3.1]: https://github.com/totok22/feishu-docs-publisher/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/totok22/feishu-docs-publisher/compare/0.2.1...0.3.0
[0.2.1]: https://github.com/totok22/feishu-docs-publisher/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/totok22/feishu-docs-publisher/compare/0.1.26...0.2.0
