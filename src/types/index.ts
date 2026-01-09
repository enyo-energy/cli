export interface DevPackageInstallRequest {
    packageId: string;
    packageName: string;
    packageVersion: number;
    packageBundle: string;
    debugToken: string;
    sdkVersion: string;
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