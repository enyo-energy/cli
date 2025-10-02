import path from 'path';
import { createRequire } from 'module';
import type { RestrictedFileSystem } from './restricted-fs.js';

// Whitelist of allowed native modules - curated for security
const ALLOWED_NATIVE_MODULES = new Set([
    // File system (restricted version provided)
    'fs',
    'node:fs',

    // Path manipulation
    'path',
    'node:path',

    // URL handling
    'url',
    'node:url',

    // Utilities
    'util',
    'node:util',

    // Cryptography (read-only operations)
    'crypto',
    'node:crypto',

    // Event system
    'events',
    'node:events',

    // Buffer handling
    'buffer',
    'node:buffer',

    // Streams
    'stream',
    'node:stream',

    // Timers
    'timers',
    'node:timers',

    // Network (restricted version provided)
    'fetch',

    // Platform info (read-only)
    'os',
    'node:os',

    // Query string utilities
    'querystring',
    'node:querystring',

    // Assertions (for testing)
    'assert',
    'node:assert'
]);

export const createRestrictedRequire = (
    restrictedFS: RestrictedFileSystem,
    packageRoot: string,
    currentFilePath: string,
    restrictedFetch: typeof fetch
) => {
    const nodeRequire = createRequire(currentFilePath);

    // Create path validation function (same logic as restricted FS)
    const isPathAllowed = (targetPath: string) => {
        try {
            const normalizedPackageRoot = path.resolve(packageRoot);
            const resolvedPath = path.resolve(path.dirname(currentFilePath), targetPath);
            const normalizedPath = path.normalize(resolvedPath);

            return normalizedPath.startsWith(normalizedPackageRoot);
        } catch (error) {
            return false;
        }
    };

    return (id: string) => {
        console.log(`Require called for: ${id}`);

        // 1. NATIVE MODULES - Allow only whitelisted Node.js built-in modules
        if (ALLOWED_NATIVE_MODULES.has(id)) {
            // Special handling for fs module - return restricted filesystem
            if (id === 'fs' || id === 'node:fs') {
                return restrictedFS;
            }

            // Special handling for fetch - return network-restricted version
            if (id === 'fetch') {
                return restrictedFetch;
            }

            // For other allowed native modules, return the actual module
            // These are considered safe as they're Node.js built-ins
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return nodeRequire(id);
        }

        // 2. LOCAL FILES - Allow requires within the package directory
        if (id.startsWith('./') || id.startsWith('../') || path.isAbsolute(id)) {
            const resolvedPath = path.resolve(path.dirname(currentFilePath), id);

            // Validate the resolved path is within the allowed package directory
            if (!isPathAllowed(id)) {
                throw new Error(`Access denied: Module path '${id}' resolves to '${resolvedPath}' which is outside the package directory`);
            }

            try {
                // Load the local module using Node's standard require
                // The loaded module will run in the same restricted VM context
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return nodeRequire(id);
            } catch (error) {
                throw new Error(`Failed to load module '${id}': ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // 3. EXTERNAL PACKAGES - Currently blocked for security
        if (!id.startsWith('.') && !path.isAbsolute(id)) {
            // External npm packages are blocked by default to prevent:
            // - Accessing system resources
            // - Network access outside permitted origins
            // - Loading potentially malicious code
            //
            // Future enhancement: Could allow specific whitelisted packages
            throw new Error(`Access denied: External package '${id}' is not allowed. Only built-in modules and local files are permitted.`);
        }

        // 4. FALLBACK - Block any other require patterns
        throw new Error(`Access denied: Module '${id}' is not allowed.`);
    };
};