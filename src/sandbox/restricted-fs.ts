import * as fs from 'node:fs';
import path from 'path';

export interface RestrictedFileSystem {
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
    existsSync: typeof fs.existsSync;
    statSync: typeof fs.statSync;
    readFile: typeof fs.readFile;
    writeFile: typeof fs.writeFile;
    readdirSync: typeof fs.readdirSync;
    readdir: typeof fs.readdir;
    unlinkSync: () => never;
    rmdirSync: () => never;
    rmSync: () => never;
}

export const createRestrictedFS = (packageRoot: string): RestrictedFileSystem => {
    // Create path validation function
    const isPathAllowed = (targetPath: string) => {
        try {
            // Normalize the package root path
            const normalizedPackageRoot = path.resolve(packageRoot);

            const resolvedPath = path.resolve(packageRoot, targetPath);
            const normalizedPath = path.normalize(resolvedPath);

            // Check if the resolved path is within the package root
            return normalizedPath.startsWith(normalizedPackageRoot);
        } catch (error) {
            // If any error occurs in path resolution, deny access
            return false;
        }
    };

    const restrictedFS: any = {};
    const allowedMethods = ['readFileSync', 'writeFileSync', 'existsSync', 'statSync', 'readFile', 'writeFile', 'readdirSync', 'readdir'];

    allowedMethods.forEach(method => {
        restrictedFS[method] = (...args: any[]) => {
            const filePath = args[0];
            if (typeof filePath === 'string') {
                // Additional validation: prevent empty paths and special characters
                if (!filePath || filePath.trim() === '') {
                    throw new Error(`Access denied: Invalid path provided`);
                }

                // Check for null bytes (common directory traversal attempt)
                if (filePath.includes('\0')) {
                    throw new Error(`Access denied: Invalid characters in path`);
                }

                if (!isPathAllowed(filePath)) {
                    throw new Error(`Access denied: Path '${filePath}' is outside package directory`);
                }
            }
            // @ts-expect-error this is fine
            return fs[method](...args);
        };
    });

    // Explicitly block dangerous methods
    restrictedFS.unlinkSync = () => {
        throw new Error('Access denied: File deletion not allowed');
    };
    restrictedFS.rmdirSync = () => {
        throw new Error('Access denied: Directory deletion not allowed');
    };
    restrictedFS.rmSync = () => {
        throw new Error('Access denied: File/directory removal not allowed');
    };

    return restrictedFS as RestrictedFileSystem;
};