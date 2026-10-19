# Feishu Research Publisher

[English](README.md)

基于 [totok22/feishu-docs-publisher](https://github.com/totok22/feishu-docs-publisher) 0.3.1 的科研笔记导出 fork。保留原插件的 CLI 登录、文档发布和 PDF 上传能力，重点适配“主干＋折叠细节”的阅读方式。

**0.4.0 为预发布版**：自动化测试、原生 API 回读和局部更新实测通过；页面展开／收起的视觉验收尚未完成，不宣称完整复刻 Obsidian。

## 安装

需要桌面版 Obsidian 1.13.0 或更高版本。

1. 从 [0.4.0 Release](https://github.com/HeShiLie/feishu-docs-publisher/releases/tag/0.4.0) 下载三个独立附件：`main.js`、`manifest.json`、`styles.css`。
2. 关闭原插件，备份其程序与数据。
3. 将三个文件放入 `<Vault>/.obsidian/plugins/feishu-docs-publisher/`。只替换程序文件，保留原有 `data.json` 和 `lark-sync-state.json`。
4. 重启 Obsidian，启用 **Feishu Research Publisher**。
5. 使用原设置页配置并登录 `lark-cli`；原生转换额外需要 `docx:document.block:convert` 权限。

插件 ID 保持 `feishu-docs-publisher`，用于替换原插件，不能与上游同时启用。此 fork 尚未成为 Obsidian 社区目录中的独立条目；请从本仓库下载更新，上游更新可能覆盖定制文件。

## 功能

- 主干保持原位，Callout 标题与正文组成原生父子树，保留嵌套和代码。
- 根据 `+` / `-` 设置初始折叠状态，标题行设置背景色；不是整块彩色边框。
- PDF 引用保留名称、别名、页码；未绑定附件有可读提示。
- 相同内容不重建，变更按顶层子树更新；写入保存事务记录，避免盲目重复创建。
- 检测远端正文改动时停止；读者的展开／收起不视为正文冲突。
- 原始 Markdown 只读，绑定仅存入插件数据。

先发布一篇新的测试文档再用于现有资料。包含修改的顶层子树会被重建，其中的块 ID 和评论锚点不保证保留。PDF 裁剪嵌入仍为文件引用，精确选区跳转尚未实现；网络图片和超过 1000 块的单次原生变更会明确停止。含图片 Callout 的真实端到端验证，以及 Mermaid、复杂表格、脚注和 HTML 的全面兼容性仍未完成。

完整说明见 [安装与兼容性报告](docs/native-export-v2.md)。

## 开发与发布

```sh
npm ci
npm run check
npm run release:check
```

标签使用不带 `v` 的 `x.y.z`，与包版本和 manifest 一致；`versions.json` 记录最低 Obsidian 版本。沿用上游 GitHub Actions：推送标签后测试、构建，并生成含三个独立附件的草稿 Release。视觉验收完成前保留 GitHub 预发布标记。

发布通过本机 CLI 将所选笔记及资源发送至飞书／Lark；认证由 CLI 管理，仓库及安装包不包含账号凭据或私人测试文档。不新增遥测。

原作者为 huan.wang、totok22，科研导出改动由 HeShiLie 维护。保留 MIT 许可及原作者署名，与飞书或 Obsidian 官方没有隶属关系。参见 [LICENSE](LICENSE) 和 [变更记录](CHANGELOG.md)。
