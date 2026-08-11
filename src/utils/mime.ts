import path from 'path';

/**
 * Map a local file to its IANA MIME type.
 *
 * Shared by the logo and the firmware registry uploads so both send the same
 * `Content-Type` for the same extension. Anything unrecognised — which is the
 * normal case for firmware blobs — falls back to `application/octet-stream`.
 */
export const getContentTypeFromFile = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        case '.svg':
            return 'image/svg+xml';
        case '.webp':
            return 'image/webp';
        case '.zip':
            return 'application/zip';
        case '.gz':
        case '.tgz':
            return 'application/gzip';
        case '.tar':
            return 'application/x-tar';
        case '.json':
            return 'application/json';
        case '.txt':
            return 'text/plain';
        default:
            return 'application/octet-stream';
    }
};
