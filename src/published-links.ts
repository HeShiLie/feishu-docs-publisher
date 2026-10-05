import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";

export type PublishedLinkKind = "markdown" | "pdf" | "folder";

/** The host resolves plugin settings bindings and supplies a stable settings key. */
export interface PublishedLinkEntry {
	id: string;
	path: string;
	kind: PublishedLinkKind;
	url: string;
	token?: string;
	name?: string;
}

type MaybePromise<T> = T | Promise<T>;

/** The host validates URLs and persists documentBindings/pdfBindings/folder settings without editing notes. */
export interface PublishedLinksHost {
	getLanguage(): "zh-CN" | "en";
	listEntries(): MaybePromise<PublishedLinkEntry[]>;
	saveBindingUrl(entry: PublishedLinkEntry, url: string): MaybePromise<void>;
	/** Remove only plugin settings binding metadata. Never edit notes or delete a remote document. */
	removeBinding(entry: PublishedLinkEntry): MaybePromise<void>;
	openLocalFile?(entry: PublishedLinkEntry): MaybePromise<void>;
	sync?(entry: PublishedLinkEntry): MaybePromise<void>;
	openUrl?(url: string): MaybePromise<void>;
	copyUrl?(url: string): MaybePromise<void>;
	/** Read existing remote children and save unique matches in local settings; never create remote content. */
	recoverBindings?(folderPath: string): MaybePromise<string>;
}

const MESSAGES = {
	en: {
		title: "Published links", intro: "Manage local bindings to published Markdown, PDF, and folders.",
		localOnly: "Disconnecting removes only the binding in plugin settings. Notes and remote documents or folders remain unchanged.",
		search: "Search", searchHint: "Search paths, names, URLs, or tokens", scope: "Folder scope",
		all: "All folders", refresh: "Refresh", loading: "Loading published links…",
		recover: "Recover existing bindings", recovering: "Recovering existing bindings…",
		recoveryHint: "Read remote folder children and bind uniquely matched local filenames in plugin settings. Ambiguous matches need manual binding. Notes remain unchanged; no remote content is created.",
		empty: "No published links in this scope.", noMatches: "No published links match your search.",
		count: (visible: number, total: number) => `${visible} of ${total} published links`,
		markdown: "Markdown", pdf: "PDF", folder: "Folder", open: "Open link", copy: "Copy link",
		copied: "Link copied.", edit: "Edit binding", local: "Open local file", sync: "Sync",
		synced: "Sync completed.", disconnect: "Disconnect local binding", cancel: "Cancel", save: "Save binding",
		editTitle: "Edit published binding", url: "Published URL",
		urlHint: "Paste the Feishu/Lark URL. The plugin validates it before saving.",
		editHelp: "Save the binding in plugin settings. Notes remain unchanged; the remote document is not moved or deleted.",
		saving: "Saving…", removing: "Disconnecting…", working: "Working…",
		noUrl: "No URL stored. Edit the binding to add one.", invalidUrl: "The stored link must be an HTTP or HTTPS URL.",
		failed: "Action failed. Please try again.", previous: "Previous", next: "Next",
		page: (page: number, pages: number) => `Page ${page} of ${pages}`
	},
	"zh-CN": {
		title: "已发布链接", intro: "管理已发布 Markdown、PDF 和文件夹的本地绑定。",
		localOnly: "断开绑定仅移除插件设置中的绑定，不会修改笔记，也不会修改或删除远端文档或文件夹。",
		search: "搜索", searchHint: "搜索路径、名称、URL 或 token", scope: "文件夹范围",
		all: "所有文件夹", refresh: "刷新", loading: "正在加载已发布链接…",
		recover: "恢复已有发布绑定", recovering: "正在恢复已有发布绑定…",
		recoveryHint: "读取远端文件夹子项，将与本地文件名唯一匹配的绑定保存到插件设置。有歧义的匹配需手动绑定，不修改笔记，也不创建远端内容。",
		empty: "此范围内没有已发布链接。", noMatches: "没有匹配的已发布链接。",
		count: (visible: number, total: number) => `${visible} / ${total} 个已发布链接`,
		markdown: "Markdown", pdf: "PDF", folder: "文件夹", open: "打开链接", copy: "复制链接",
		copied: "链接已复制。", edit: "编辑绑定", local: "打开本地文件", sync: "同步",
		synced: "同步完成。", disconnect: "断开本地绑定", cancel: "取消", save: "保存绑定",
		editTitle: "编辑发布绑定", url: "已发布 URL",
		urlHint: "粘贴飞书 / Lark URL，插件会在保存前验证。",
		editHelp: "绑定保存到插件设置，不修改笔记，也不会移动或删除远端文档。",
		saving: "正在保存…", removing: "正在断开…", working: "正在处理…",
		noUrl: "尚未保存 URL，可编辑绑定添加链接。", invalidUrl: "已保存链接必须使用 HTTP 或 HTTPS。",
		failed: "操作失败，请重试。", previous: "上一页", next: "下一页",
		page: (page: number, pages: number) => `第 ${page} / ${pages} 页`
	}
};

function messages(host: PublishedLinksHost) {
	return MESSAGES[host.getLanguage()] || MESSAGES["zh-CN"];
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Scope includes the folder itself and its descendants, not similarly named siblings. */
export function filterPublishedLinks(entries: readonly PublishedLinkEntry[], query = "", folderPath = ""): PublishedLinkEntry[] {
	const scope = normalizePath(folderPath);
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	return entries.filter((entry) => {
		const path = normalizePath(entry.path);
		if (scope && path !== scope && !path.startsWith(`${scope}/`)) return false;
		const haystack = [entry.path, entry.name || "", entry.url, entry.token || ""].join(" ").toLocaleLowerCase();
		return terms.every((term) => haystack.includes(term));
	}).sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function createFeedback(container: HTMLElement): HTMLParagraphElement {
	const feedback = container.createEl("p", { cls: "feishu-lark-published-feedback" });
	feedback.setAttribute("role", "status");
	feedback.setAttribute("aria-live", "polite");
	feedback.setAttribute("aria-atomic", "true");
	return feedback;
}

function showFeedback(element: HTMLElement, text: string, error = false): void {
	element.setText(text);
	element.toggleClass("is-error", error);
}

export class PublishedLinksModal extends Modal {
	private entries: PublishedLinkEntry[] = [];
	private query = "";
	private page = 0;
	private readonly pageSize = 50;
	private requestId = 0;
	private renderRevision = 0;
	private active = false;
	private loaded = false;
	private listEl!: HTMLElement;
	private countEl!: HTMLElement;
	private feedbackEl!: HTMLElement;
	private refreshButton!: ButtonComponent;
	private recoveryButton?: ButtonComponent;
	private recovering = false;
	private readonly pending = new Set<string>();

	constructor(app: App, private readonly host: PublishedLinksHost, private readonly folderPath = "") {
		super(app);
	}

	onOpen(): void {
		this.active = true;
		const t = messages(this.host);
		this.modalEl.addClass("feishu-lark-published-modal");
		this.contentEl.empty();
		this.titleEl.setText(t.title);
		this.contentEl.createEl("p", { text: t.intro });
		this.contentEl.createEl("p", { text: t.localOnly, cls: "setting-item-description" });
		const toolbar = new Setting(this.contentEl).setName(t.scope).setDesc(normalizePath(this.folderPath) || t.all)
			.addButton((button) => {
				this.refreshButton = button.setButtonText(t.refresh).onClick(() => { void this.refresh(); });
			});
		if (this.host.recoverBindings) {
			toolbar.addButton((button) => {
				this.recoveryButton = button.setButtonText(t.recover).onClick(() => { void this.recoverBindings(); });
			});
			this.contentEl.createEl("p", { text: t.recoveryHint, cls: "setting-item-description" });
		}
		new Setting(this.contentEl).setName(t.search).addSearch((search) => {
			search.setPlaceholder(t.searchHint).setValue(this.query).onChange((value) => {
				this.query = value;
				this.page = 0;
				this.renderList();
			});
			search.inputEl.setAttribute("aria-label", t.searchHint);
		});
		this.feedbackEl = createFeedback(this.contentEl);
		this.countEl = createFeedback(this.contentEl);
		this.listEl = this.contentEl.createDiv({ cls: "feishu-lark-published-list" });
		void this.refresh();
	}

	onClose(): void {
		this.active = false;
		this.requestId += 1;
		this.contentEl.empty();
	}

	async refresh(successMessage = ""): Promise<void> {
		if (!this.active) return;
		const requestId = ++this.requestId;
		const t = messages(this.host);
		this.refreshButton.setDisabled(true);
		this.recoveryButton?.setDisabled(true);
		showFeedback(this.feedbackEl, t.loading);
		try {
			const entries = await this.host.listEntries();
			if (!this.active || requestId !== this.requestId) return;
			this.entries = entries;
			this.loaded = true;
			showFeedback(this.feedbackEl, successMessage);
			this.renderList();
		} catch (error) {
			if (this.active && requestId === this.requestId) {
				showFeedback(this.feedbackEl, [successMessage, errorMessage(error, t.failed)].filter(Boolean).join("\n"), true);
			}
		} finally {
			if (this.active && requestId === this.requestId) {
				this.refreshButton.setDisabled(this.recovering);
				this.recoveryButton?.setDisabled(this.recovering);
			}
		}
	}

	private async recoverBindings(): Promise<void> {
		if (!this.active || this.recovering || !this.host.recoverBindings) return;
		this.recovering = true;
		this.recoveryButton?.setDisabled(true);
		this.refreshButton.setDisabled(true);
		const t = messages(this.host);
		showFeedback(this.feedbackEl, t.recovering);
		try {
			const summary = await this.host.recoverBindings(normalizePath(this.folderPath));
			if (this.active) await this.refresh(summary);
		} catch (error) {
			if (this.active) showFeedback(this.feedbackEl, errorMessage(error, t.failed), true);
		} finally {
			this.recovering = false;
			if (this.active) {
				this.recoveryButton?.setDisabled(false);
				this.refreshButton.setDisabled(false);
			}
		}
	}

	private renderList(): void {
		if (!this.active || !this.loaded) return;
		this.renderRevision += 1;
		const t = messages(this.host);
		const scoped = filterPublishedLinks(this.entries, "", this.folderPath);
		const filtered = filterPublishedLinks(scoped, this.query);
		const pages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
		this.page = Math.min(this.page, pages - 1);
		this.countEl.setText(t.count(filtered.length, scoped.length));
		this.listEl.empty();
		if (!filtered.length) {
			this.listEl.createEl("p", { text: this.query.trim() ? t.noMatches : t.empty });
			return;
		}
		for (const entry of filtered.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) this.renderEntry(entry);
		if (pages > 1) {
			new Setting(this.listEl).setName(t.page(this.page + 1, pages))
				.addButton((button) => button.setButtonText(t.previous).setDisabled(this.page === 0).onClick(() => {
					this.page -= 1;
					this.renderList();
				}))
				.addButton((button) => button.setButtonText(t.next).setDisabled(this.page === pages - 1).onClick(() => {
					this.page += 1;
					this.renderList();
				}));
		}
	}

	private renderEntry(entry: PublishedLinkEntry): void {
		const t = messages(this.host);
		const controls: { button: ButtonComponent; disabled: boolean }[] = [];
		const setting = new Setting(this.listEl).setName(entry.name || entry.path || "/")
			.setDesc(`${t[entry.kind]} · ${entry.path || "/"}\n${entry.url || t.noUrl}`);
		setting.settingEl.addClass("feishu-lark-published-entry");
		const addAction = (label: string, action: () => MaybePromise<void>, disabled = false): void => {
			setting.addButton((button) => {
				controls.push({ button, disabled });
				button.setButtonText(label).setDisabled(disabled || this.pending.has(entry.id))
					.onClick(() => { void this.runAction(entry, action, controls); });
			});
		};
		addAction(t.open, async () => {
			const url = new URL(entry.url);
			if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(t.invalidUrl);
			if (this.host.openUrl) await this.host.openUrl(entry.url);
			else this.contentEl.ownerDocument.defaultView?.open(entry.url, "_blank", "noopener,noreferrer");
		}, !entry.url);
		addAction(t.copy, async () => {
			if (this.host.copyUrl) await this.host.copyUrl(entry.url);
			else {
				const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
				if (!clipboard) throw new Error(t.failed);
				await clipboard.writeText(entry.url);
			}
			if (this.active) showFeedback(this.feedbackEl, t.copied);
		}, !entry.url);
		addAction(t.edit, () => {
			new PublishedLinkBindingModal(this.app, this.host, entry, () => this.refresh()).open();
		});
		if (this.host.openLocalFile && entry.kind !== "folder") addAction(t.local, () => this.host.openLocalFile!(entry));
		if (this.host.sync) addAction(t.sync, async () => {
			await this.host.sync!(entry);
			await this.refresh();
			if (this.active) showFeedback(this.feedbackEl, t.synced);
		});
		addAction(t.disconnect, () => {
			new DisconnectPublishedLinkModal(this.app, this.host, entry, () => this.refresh()).open();
		});
	}

	private async runAction(entry: PublishedLinkEntry, action: () => MaybePromise<void>,
		controls: { button: ButtonComponent; disabled: boolean }[]): Promise<void> {
		if (this.pending.has(entry.id)) return;
		const renderRevision = this.renderRevision;
		this.pending.add(entry.id);
		showFeedback(this.feedbackEl, messages(this.host).working);
		controls.forEach(({ button }) => button.setDisabled(true));
		try {
			await action();
			if (this.active && this.feedbackEl.textContent === messages(this.host).working) showFeedback(this.feedbackEl, "");
		} catch (error) {
			if (this.active) showFeedback(this.feedbackEl, errorMessage(error, messages(this.host).failed), true);
		} finally {
			this.pending.delete(entry.id);
			if (this.active) {
				if (renderRevision !== this.renderRevision) this.renderList();
				else controls.forEach(({ button, disabled }) => button.setDisabled(disabled));
			}
		}
	}
}

/** Shared modal keeps errors beside the form and prevents duplicate submissions. */
abstract class PublishedLinkActionModal extends Modal {
	protected feedbackEl!: HTMLElement;
	protected buttons: ButtonComponent[] = [];
	protected active = false;
	private busy = false;
	protected onActionError(): void {}

	constructor(app: App, protected readonly host: PublishedLinksHost, protected readonly entry: PublishedLinkEntry,
		private readonly onSaved: () => MaybePromise<void> = () => {}) {
		super(app);
	}

	protected addActions(label: string, busyLabel: string, action: () => MaybePromise<void>, warning = false): void {
		const t = messages(this.host);
		this.feedbackEl = createFeedback(this.contentEl);
		new Setting(this.contentEl).addButton((button) => {
			this.buttons.push(button.setButtonText(t.cancel).onClick(() => this.close()));
		}).addButton((button) => {
			this.buttons.push(button.setButtonText(label));
			if (warning) button.setWarning();
			else button.setCta();
			button.onClick(() => { void this.submit(button, label, busyLabel, action); });
		});
	}

	private async submit(button: ButtonComponent, label: string, busyLabel: string, action: () => MaybePromise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.buttons.forEach((control) => control.setDisabled(true));
		button.setButtonText(busyLabel);
		showFeedback(this.feedbackEl, "");
		try {
			await action();
			this.close();
			await this.onSaved();
		} catch (error) {
			if (this.active) {
				showFeedback(this.feedbackEl, errorMessage(error, messages(this.host).failed), true);
				this.onActionError();
			}
		} finally {
			this.busy = false;
			if (this.active) {
				this.buttons.forEach((control) => control.setDisabled(false));
				button.setButtonText(label);
			}
		}
	}

	onClose(): void {
		this.active = false;
		this.buttons = [];
		this.contentEl.empty();
	}
}

export class PublishedLinkBindingModal extends PublishedLinkActionModal {
	private input?: TextComponent;

	protected onActionError(): void {
		this.input?.inputEl.setAttribute("aria-invalid", "true");
		this.input?.inputEl.focus();
	}

	onOpen(): void {
		this.active = true;
		const t = messages(this.host);
		this.titleEl.setText(t.editTitle);
		this.contentEl.createEl("p", { text: this.entry.path || "/" });
		this.contentEl.createEl("p", { text: t.editHelp, cls: "setting-item-description" });
		let url = this.entry.url;
		let input: TextComponent | undefined;
		new Setting(this.contentEl).setName(t.url).setDesc(t.urlHint).addText((text) => {
			this.input = input = text;
			text.setValue(url).setPlaceholder("https://…").onChange((value) => {
				url = value;
				text.inputEl.setAttribute("aria-invalid", "false");
			});
			text.inputEl.setAttribute("aria-label", t.url);
			text.inputEl.type = "url";
		});
		this.addActions(t.save, t.saving, () => this.host.saveBindingUrl(this.entry, url.trim()));
		if (input) {
			input.inputEl.setAttribute("aria-describedby", this.feedbackEl.id = `published-link-error-${Date.now()}`);
			input.inputEl.focus();
		}
	}
}

class DisconnectPublishedLinkModal extends PublishedLinkActionModal {
	onOpen(): void {
		this.active = true;
		const t = messages(this.host);
		this.titleEl.setText(t.disconnect);
		this.contentEl.createEl("p", { text: this.entry.path || "/" });
		this.contentEl.createEl("p", { text: t.localOnly });
		this.addActions(t.disconnect, t.removing, () => this.host.removeBinding(this.entry), true);
	}
}
