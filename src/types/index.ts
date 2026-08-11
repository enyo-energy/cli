import type {
    EnergyAppPackageFirmwareFile,
    EnergyAppPackagePermission,
    EnergyAppPermissionType
} from '@enyo-energy/energy-app-sdk';

export interface DevPackageInstallRequest {
    packageName: string;
    packageVersion: number;
    packageBundle: string;
    debugToken: string;
    sdkVersion: string;
    /**
     * Passed straight through from the package definition, which allows both
     * the bare permission type and the `{permission, internalComment}` form.
     */
    permissions: (EnergyAppPermissionType | EnergyAppPackagePermission)[];
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
    /**
     * One entry per declared firmware file, echoing back what still has to be
     * uploaded. Mirrors the `uploadLogo` checksum / `logoUploadUrl` handshake:
     * the CLI sends the content hashes, the backend answers with signed PUT
     * URLs only for the blobs it does not already hold.
     */
    firmwareUploads?: FirmwareUploadTarget[];
    versionNumber: number;
}

/** The backend's answer for one declared firmware file. */
export interface FirmwareUploadTarget {
    /** The `fileId` from the package definition. */
    fileId: string;
    /** Lowercase hex SHA-256 the URL was issued for. */
    sha256: string;
    /**
     * Signed PUT URL for the blob. Absent when the registry already holds this
     * sha256 for the package — firmware images are large and rarely change
     * between releases, so those are referenced rather than re-uploaded.
     */
    uploadUrl?: string;
}

/**
 * A firmware entry as it is published in the package definition: the local
 * `path` removed, the content metadata the runtime needs added.
 */
export interface PublishedFirmwareFile extends Omit<EnergyAppPackageFirmwareFile, 'path'> {
    /** Lowercase hex SHA-256 of the file content. */
    sha256: string;
    /** Size of the file in bytes. */
    sizeBytes: number;
    /** Basename of the declared local path, e.g. `wallbox-2.4.1.bin`. */
    fileName: string;
    /** IANA MIME type; `application/octet-stream` for unrecognised blobs. */
    mimeType: string;
}

/** A declared firmware file resolved on disk, fingerprinted and ready to upload. */
export interface PreparedFirmwareFile {
    fileId: string;
    /** The `path` exactly as declared in the package definition. */
    declaredPath: string;
    /** The declared path resolved against the package root. */
    absolutePath: string;
    sha256: string;
    sizeBytes: number;
    fileName: string;
    mimeType: string;
    /** The form this entry takes in the published definition. */
    published: PublishedFirmwareFile;
}

export interface ReleaseNote {
    language: 'de' | 'en';
    note: string;
}

export interface CommandOptions {
    host?: string;
    port?: string;
    token?: string;
    apiKey?: string;
    registry?: string;
    file?: string;
    channel?: 'production' | 'staging';
    releaseNotes?: string;
}

export interface SubscribeLogsOptions extends CommandOptions {
    packageName?: string;
}

export interface SubscribeEebusOptions extends CommandOptions {
    /** Emit one raw JSON line per message — table-renderer friendly. */
    json?: boolean;
    /** Print full SKI instead of the abbreviated last-4-hex form. */
    fullSki?: boolean;
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