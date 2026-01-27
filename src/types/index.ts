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
}

export interface CommandOptions {
    host?: string;
    port?: string;
    token?: string;
    apiKey?: string;
    registry?: string;
    file?: string;
}

export interface SubscribeLogsOptions extends CommandOptions {
    packageName?: string;
}

export interface SecretCommandOptions {
    name: string;
    value?: string;
    file?: string;
    token: string;
    masterSecret: string;
}

export interface SecretRequest {
    name: string;
    encryptedSecret: string;
}

export interface SecretResponse {
    success: boolean;
    message?: string;
    error?: string;
}