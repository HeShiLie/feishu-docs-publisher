import assert from "node:assert/strict";
import esbuild from "esbuild";

await esbuild.build({
	bundle: true,
	entryPoints: ["src/lark-cli-management.ts"],
	format: "esm",
	outfile: "test/.tmp-lark-cli-management-test.mjs",
	platform: "node",
	target: "node20"
});

const {
	applyProxyEnvironment,
	buildProxyUrl,
	detectProxyEnvironment,
	extractLarkCliVerificationUrl,
	isLarkCliVersionNewer,
	isSafeVerificationUrl,
	normalizeProxyHost,
	normalizeProxyPort,
	parseLarkCliAuthList,
	parseLarkCliAuthStatus,
	parseLarkCliDeviceAuthorization,
	parseLarkCliError,
	parseLarkCliUpdateCheck,
	parseNpmVersionOutput
} = await import("./.tmp-lark-cli-management-test.mjs");

assert.equal(normalizeProxyHost("http://127.0.0.1:7890"), "127.0.0.1");
assert.equal(normalizeProxyHost("127.0.0.1:8123"), "127.0.0.1");
assert.equal(normalizeProxyHost("localhost/ignored"), "localhost");
assert.equal(normalizeProxyHost("[::1]"), "::1");
assert.equal(normalizeProxyHost("[::1]:8123"), "::1");
assert.equal(normalizeProxyHost("  "), "127.0.0.1");
assert.equal(normalizeProxyPort("7890"), 7890);
assert.equal(normalizeProxyPort("70000"), 7890);
assert.equal(buildProxyUrl("127.0.0.1", 7890), "http://127.0.0.1:7890");
assert.equal(buildProxyUrl("::1", 7890), "http://[::1]:7890");

const baseEnvironment = {
	PATH: "/usr/bin",
	HTTPS_PROXY: "http://old.example:8080",
	https_proxy: "http://old.example:8080",
	NO_PROXY: "localhost",
	LARKSUITE_CLI_PROXY_ENABLE: "1",
	LARKSUITE_CLI_PROXY_ADDRESS: "http://127.0.0.1:9999",
	LARK_CLI_NO_PROXY: "1"
};
const systemEnvironment = applyProxyEnvironment(baseEnvironment, {
	proxyMode: "system",
	proxyHost: "127.0.0.1",
	proxyPort: 7890
});
assert.equal(systemEnvironment.HTTPS_PROXY, "http://old.example:8080");
assert.equal(systemEnvironment.LARK_CLI_NO_PROXY, "1");

const customEnvironment = applyProxyEnvironment(baseEnvironment, {
	proxyMode: "custom",
	proxyHost: "127.0.0.1",
	proxyPort: 7890
});
for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]) {
	assert.equal(customEnvironment[key], "http://127.0.0.1:7890", key);
}
assert.equal(customEnvironment.NO_PROXY, "localhost", "custom proxy must preserve no-proxy exclusions");
assert.equal(customEnvironment.LARKSUITE_CLI_PROXY_ENABLE, "0");
assert.equal(customEnvironment.LARK_CLI_NO_PROXY, undefined);
assert.equal(customEnvironment.LARK_CLI_NO_PROXY_WARN, "1");

const directEnvironment = applyProxyEnvironment(baseEnvironment, {
	proxyMode: "off",
	proxyHost: "127.0.0.1",
	proxyPort: 7890
});
assert.equal(directEnvironment.HTTPS_PROXY, undefined);
assert.equal(directEnvironment.https_proxy, undefined);
assert.equal(directEnvironment.LARKSUITE_CLI_PROXY_ADDRESS, undefined);
assert.equal(directEnvironment.LARK_CLI_NO_PROXY, "1");
assert.equal(directEnvironment.LARKSUITE_CLI_PROXY_ENABLE, "0");

assert.deepEqual(detectProxyEnvironment({ HTTPS_PROXY: "http://user:secret@127.0.0.1:7890" }), {
	key: "HTTPS_PROXY",
	value: "http://127.0.0.1:7890"
});
assert.equal(detectProxyEnvironment({ NO_PROXY: "localhost" }), null);

assert.deepEqual(parseLarkCliAuthList(JSON.stringify([
	{ userName: "Alex", userOpenId: "ou_1", tokenStatus: "valid" }
])), {
	configured: true,
	users: [{ userName: "Alex", userOpenId: "ou_1", tokenStatus: "valid" }]
});
assert.deepEqual(parseLarkCliAuthList('{"ok":true,"users":[],"reason":"not_configured"}'), {
	configured: false,
	users: []
});
assert.equal(parseLarkCliAuthList('{"ok":true,"users":[],"reason":"not_logged_in"}').configured, true);

assert.deepEqual(parseLarkCliAuthStatus(JSON.stringify({
	appId: "cli_1",
	brand: "lark",
	identity: "user",
	identities: {
		user: {
			available: true,
			userName: "Alex",
			tokenStatus: "valid",
			expiresAt: "2026-10-18T00:00:00Z"
		}
	}
})), {
	appId: "cli_1",
	brand: "lark",
	loggedIn: true,
	userName: "Alex",
	tokenStatus: "valid",
	expiresAt: "2026-10-18T00:00:00Z",
	identity: "user"
});

assert.deepEqual(parseLarkCliDeviceAuthorization(JSON.stringify({
	verification_url: "https://open.feishu.cn/page/cli?user_code=ABCD",
	device_code: "device-code",
	expires_in: 600
})), {
	deviceCode: "device-code",
	verificationUrl: "https://open.feishu.cn/page/cli?user_code=ABCD",
	expiresIn: 600
});
assert.equal(parseLarkCliDeviceAuthorization('{"verification_url":"javascript:alert(1)","device_code":"x"}'), null);
assert.equal(isSafeVerificationUrl("https://open.larksuite.com/page/cli?code=1"), true);
assert.equal(isSafeVerificationUrl("file:///tmp/token"), false);

const configOutput = `[QR]\nOpen: https://open.feishu.cn/page/cli?user_code=ABCD.\nWaiting...`;
assert.equal(extractLarkCliVerificationUrl(configOutput), "https://open.feishu.cn/page/cli?user_code=ABCD");
assert.equal(extractLarkCliVerificationUrl("no links here"), "");

assert.deepEqual(parseLarkCliUpdateCheck(JSON.stringify({
	ok: true,
	current_version: "1.0.96",
	latest_version: "1.0.98",
	action: "update_available",
	auto_update: true,
	url: "https://github.com/larksuite/cli/releases/tag/v1.0.98",
	message: "update available"
})), {
	currentVersion: "1.0.96",
	latestVersion: "1.0.98",
	action: "update_available",
	autoUpdate: true,
	url: "https://github.com/larksuite/cli/releases/tag/v1.0.98",
	message: "update available"
});
assert.equal(isLarkCliVersionNewer("1.0.98", "1.0.96"), true);
assert.equal(isLarkCliVersionNewer("1.0.96", "1.0.98"), false);
assert.equal(isLarkCliVersionNewer("1.0.98", "1.0.98"), false);

assert.deepEqual(parseLarkCliError(JSON.stringify({
	error: { type: "config", subtype: "not_configured", message: "not configured", hint: "run init" }
})), {
	type: "config",
	subtype: "not_configured",
	message: "not configured",
	hint: "run init"
});
assert.equal(parseNpmVersionOutput('"1.0.98"'), "1.0.98");

console.log("lark-cli management tests passed");
