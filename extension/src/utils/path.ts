import os from "os";
import * as path from "path";

/*
The Node.js 'path' module resolves and normalizes paths differently depending on the platform:
- On Windows, it uses backslashes (\) as the default path separator.
- On POSIX-compliant systems (Linux, macOS), it uses forward slashes (/) as the default path separator.

Our approach:
1. We present paths with forward slashes to the AI and user for consistency.
2. We use the 'arePathsEqual' function for safe path comparisons.
3. Internally, Node.js gracefully handles both backslashes and forward slashes.

This strategy ensures consistent path presentation while leveraging Node.js's built-in
path handling capabilities across different platforms.
*/

export function toPosixPath(p: string): string {
    // Extended-Length Paths in Windows start with "\\?\" to allow longer paths and bypass usual parsing
    const isExtendedLengthPath = p.startsWith("\\\\?\\");

    if (isExtendedLengthPath) {
        return p;
    }

    return p.replace(/\\/g, "/");
}

// Declaration merging allows us to add a new method to the String type
declare global {
    interface String {
        toPosix(): string;
    }
}

String.prototype.toPosix = function (this: string): string {
    return toPosixPath(this);
};

// Safe path comparison that works across different platforms
export function arePathsEqual(path1?: string, path2?: string): boolean {
    if (!path1 && !path2) {
        return true;
    }
    if (!path1 || !path2) {
        return false;
    }

    path1 = normalizePath(path1);
    path2 = normalizePath(path2);

    if (process.platform === "win32") {
        return path1.toLowerCase() === path2.toLowerCase();
    }
    return path1 === path2;
}

export function normalizePath(p: string): string {
    // normalize resolves ./.. segments, removes duplicate slashes, and standardizes path separators
    let normalized = path.normalize(p);
    // however it doesn't remove trailing slashes
    // remove trailing slash, except for root paths
    if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

export function getReadablePath(cwd: string, relPath?: string): string {
    relPath = relPath || "";
    // path.resolve is flexible in that it will resolve relative paths like '../../' to the cwd
    // and even ignore the cwd if the relPath is actually an absolute path
    const absolutePath = path.resolve(cwd, relPath);
    if (arePathsEqual(cwd, path.join(os.homedir(), "Desktop"))) {
        // User opened vscode without a workspace, so cwd is the Desktop
        // Show the full absolute path to keep the user aware of where files are being created
        return absolutePath.toPosix();
    }
    if (arePathsEqual(path.normalize(absolutePath), path.normalize(cwd))) {
        return path.basename(absolutePath).toPosix();
    } else {
        // show the relative path to the cwd
        const normalizedRelPath = path.relative(cwd, absolutePath);
        if (absolutePath.includes(cwd)) {
            return normalizedRelPath.toPosix();
        } else {
            // we are outside the cwd, so show the absolute path
            return absolutePath.toPosix();
        }
    }
}