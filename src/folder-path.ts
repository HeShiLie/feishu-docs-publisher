export function normalizePath(path: string): string {
	const parts: string[] = [];

	for (const part of path.replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	return parts.join("/");
}

export function getSelectedFolderName(folderPath: string): string {
	const normalizedFolderPath = normalizePath(folderPath);
	const segments = normalizedFolderPath.split("/").filter(Boolean);
	return segments[segments.length - 1] || normalizedFolderPath || "Untitled";
}

/**
 * Reconnect a folder without leaving an ancestor exclusion in place.
 * A marker such as "Root" also hides "Root/Child", so binding "Root/Child"
 * must clear every marker that covers it.
 */
export function clearDisconnectedFolderPaths(
	disconnectedFolders: Record<string, boolean>,
	folderPath: string
): boolean {
	const normalizedFolderPath = normalizePath(folderPath);
	let changed = false;
	for (const folder of Object.keys(disconnectedFolders)) {
		if (!disconnectedFolders[folder]) continue;
		const normalizedFolder = normalizePath(folder);
		if (normalizedFolderPath === normalizedFolder || normalizedFolderPath.startsWith(`${normalizedFolder}/`)) {
			delete disconnectedFolders[folder];
			changed = true;
		}
	}
	return changed;
}

export function getRemoteParentPath(folderPath: string, filePath: string, remoteRoot: string): string {
	const normalizedFolderPath = normalizePath(folderPath);
	const relativeFilePath = normalizePath(filePath.slice(normalizedFolderPath.length).replace(/^\/+/, ""));
	const parent = parentPath(relativeFilePath);
	return normalizePath(`${remoteRoot}/${parent}`);
}

function parentPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index >= 0 ? path.slice(0, index) : "";
}
