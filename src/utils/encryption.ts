import crypto from 'crypto';

export function encryptSecret(secretValue: string, masterSecret: string): string {
    const algorithm = 'aes-256-gcm';

    const key = crypto.createHash('sha256').update(masterSecret).digest();

    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(secretValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
    ]);

    return combined.toString('base64');
}

export function decryptSecret(encryptedSecret: string, masterSecret: string): string {
    const algorithm = 'aes-256-gcm';

    const combined = Buffer.from(encryptedSecret, 'base64');

    const iv = combined.subarray(0, 16);
    const authTag = combined.subarray(16, 32);
    const encrypted = combined.subarray(32);

    const key = crypto.createHash('sha256').update(masterSecret).digest();

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}