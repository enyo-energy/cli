export interface DevPackageInstallRequest {
    packageId: string;
    packageName: string;
    packageVersion: number;
    packageBundle: string;
    debugToken: string;
    permissions: string[];
    options?: any;
}

export interface DevPackageInstallResponse {
    message: string;
    packageId: string;
    packageName: string;
    packageVersion: number;
}

export interface ReleaseResponse {
    uploadUrl: string;
    releaseId: string;
}

export interface CommandOptions {
    host?: string;
    port?: string;
    token?: string;
    apiKey?: string;
    registry?: string;
}