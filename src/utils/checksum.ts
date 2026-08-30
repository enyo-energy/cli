import fs from 'fs';
import crypto from 'crypto';

/**
 * SHA-256 a file by streaming it.
 *
 * Streaming rather than `readFileSync` so that tens-of-MB firmware images never
 * sit in memory whole. Shared by every content-addressed upload (firmware
 * images, public package files) so the registry is handed the same fingerprint
 * for the same bytes regardless of which pipeline produced them.
 *
 * @param filePath - Absolute path of the file to fingerprint.
 * @returns The lowercase hex digest.
 */
export const hashFile = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};
