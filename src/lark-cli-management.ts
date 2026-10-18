export {
	applyProxyEnvironment,
	buildProxyUrl,
	DEFAULT_PROXY_HOST,
	DEFAULT_PROXY_PORT,
	detectProxyEnvironment,
	LarkCliProxyEnvironment,
	LarkCliProxyMode,
	LarkCliProxySettings,
	normalizeProxyHost,
	normalizeProxyMode,
	normalizeProxyPort
} from "./lark-cli-command";

export type LarkCliBrand = "feishu" | "lark";

export interface LarkCliAuthUser {
	userName: string;
	userOpenId: string;
	tokenStatus: string;
}

export interface LarkCliAuthList {
	configured: boolean;
	users: LarkCliAuthUser[];
}

export interface LarkCliAuthStatus {
	appId: string;
	brand: string;
	loggedIn: boolean;
	userName: string;
	tokenStatus: string;
	expiresAt: string;
	identity: string;
}

export interface LarkCliDeviceAuthorization {
	deviceCode: string;
	verificationUrl: string;
	expiresIn: number;
}

export interface LarkCliUpdateCheck {
	currentVersion: string;
	latestVersion: string;
	action: string;
	autoUpdate: boolean;
	url: string;
	message: string;
}

export interface LarkCliErrorDetails {
	type: string;
	subtype: string;
	message: string;
	hint: string;
}

export const LARK_CLI_NPM_PACKAGE = "@larksuite/cli";
export const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

export function normalizeLarkCliBrand(value: unknown): LarkCliBrand {
	return value === "lark" ? "lark" : "feishu";
}

export function parseLarkCliAuthList(rawJson: string): LarkCliAuthList | null {
	const parsed = parseJson(rawJson);
	if (Array.isArray(parsed)) {
		return {
			configured: true,
			users: parsed.map(parseAuthUser).filter((user): user is LarkCliAuthUser => Boolean(user))
		};
	}
	if (!isRecord(parsed)) return null;

	const reason = typeof parsed.reason === "string" ? parsed.reason : "";
	const configured = reason !== "not_configured" && !("error" in parsed && reason === "");
	const rawUsers = Array.isArray(parsed.users) ? parsed.users : [];
	return {
		configured,
		users: rawUsers.map(parseAuthUser).filter((user): user is LarkCliAuthUser => Boolean(user))
	};
}

function parseAuthUser(value: unknown): LarkCliAuthUser | null {
	if (!isRecord(value)) return null;
	return {
		userName: optionalString(value.userName),
		userOpenId: optionalString(value.userOpenId),
		tokenStatus: optionalString(value.tokenStatus)
	};
}

export function parseLarkCliAuthStatus(rawJson: string): LarkCliAuthStatus | null {
	const parsed = parseJson(rawJson);
	if (!isRecord(parsed)) return null;
	const identities = isRecord(parsed.identities) ? parsed.identities : {};
	const user = isRecord(identities.user) ? identities.user : {};
	return {
		appId: optionalString(parsed.appId),
		brand: optionalString(parsed.brand),
		loggedIn: user.available === true,
		userName: optionalString(user.userName),
		tokenStatus: optionalString(user.tokenStatus),
		expiresAt: optionalString(user.expiresAt),
		identity: optionalString(parsed.identity)
	};
}

export function parseLarkCliDeviceAuthorization(rawJson: string): LarkCliDeviceAuthorization | null {
	const parsed = parseJson(rawJson);
	if (!isRecord(parsed)) return null;
	const deviceCode = optionalString(parsed.device_code);
	const verificationUrl = optionalString(parsed.verification_url)
		|| optionalString(parsed.verification_uri_complete);
	if (!deviceCode || !isSafeVerificationUrl(verificationUrl)) return null;
	const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 0;
	return { deviceCode, verificationUrl, expiresIn };
}

export function extractLarkCliVerificationUrl(output: string): string {
	const candidates = output.match(/https?:\/\/[^\s<>"']+/g) || [];
	const urls = candidates
		.map((candidate) => candidate.replace(/[),.;]+$/, ""))
		.filter(isSafeVerificationUrl);
	return urls.find((url) => url.includes("/page/cli")) || urls[0] || "";
}

export function isSafeVerificationUrl(value: string): boolean {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

export function parseLarkCliUpdateCheck(rawJson: string): LarkCliUpdateCheck | null {
	const parsed = parseJson(rawJson);
	if (!isRecord(parsed) || parsed.ok !== true) return null;
	return {
		currentVersion: optionalString(parsed.current_version),
		latestVersion: optionalString(parsed.latest_version),
		action: optionalString(parsed.action),
		autoUpdate: parsed.auto_update === true,
		url: optionalString(parsed.url),
		message: optionalString(parsed.message)
	};
}

export function parseLarkCliError(raw: string): LarkCliErrorDetails | null {
	const parsed = parseJson(raw);
	if (!isRecord(parsed) || !isRecord(parsed.error)) return null;
	return {
		type: optionalString(parsed.error.type),
		subtype: optionalString(parsed.error.subtype),
		message: optionalString(parsed.error.message),
		hint: optionalString(parsed.error.hint)
	};
}

export function parseNpmVersionOutput(output: string): string {
	return output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] || "";
}

export function isLarkCliVersionNewer(candidate: string, current: string): boolean {
	const candidateParts = parseCoreVersion(candidate);
	const currentParts = parseCoreVersion(current);
	if (!candidateParts || !currentParts) return false;
	for (let index = 0; index < 3; index += 1) {
		const difference = (candidateParts[index] || 0) - (currentParts[index] || 0);
		if (difference !== 0) return difference > 0;
	}
	return false;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseCoreVersion(value: string): [number, number, number] | null {
	const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	const parts = [Number.parseInt(match[1] || "", 10), Number.parseInt(match[2] || "", 10), Number.parseInt(match[3] || "", 10)];
	if (parts.some((part) => !Number.isFinite(part))) return null;
	return [parts[0]!, parts[1]!, parts[2]!];
}
