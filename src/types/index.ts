export interface DevPackageInstallRequest {
    packageName: string;
    packageVersion: number;
    packageBundle: string;
    debugToken: string;
    sdkVersion: string;
    permissions: string[];
    options?: any;
}

export interface DevPackageInstallResponse {
    type: 'install-dev-package-response';
    status: 'success' | 'error';
    message: string;
    data?: {
        packageId: string;
        packageName: string;
        packageVersion: number;
    };
}

export interface ReleaseResponse {
    uploadUrl: string;
    releaseId: string;
    logoUploadUrl?: string;
    version?: string | number;
    packageVersion?: string | number;
}

export interface CommandOptions {
    host?: string;
    port?: string;
    token?: string;
    apiKey?: string;
    registry?: string;
    file?: string;
    channel?: 'production' | 'staging';
}

export interface SubscribeLogsOptions extends CommandOptions {
    packageName?: string;
}

export interface SecretCommandOptions {
    name: string;
    value?: string;
    file?: string;
    apiKey: string;
    secret: string;
    registry?: string;
    secretFile?: string;
    channel?: 'production' | 'staging';
}

export interface SecretRequest {
    name: string;
    encryptedSecret: string;
    channel: 'production' | 'staging';
}

export interface SecretResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface CoreUpdateOptions extends CommandOptions {
    bundleVersion: string;
}

export interface CoreUpdateResponse {
    type: 'core-update-response';
    status: 'success' | 'error';
    message: string;
    data?: Record<string, unknown>;
}