import type {
    EnergyAppPackageFirmwareFile,
    EnergyAppPackagePermission,
    EnergyAppPackagePublicFile,
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
    /**
     * One entry per declared public file, following the same handshake as
     * {@link firmwareUploads}: the CLI sends the content hashes, the backend
     * answers with signed PUT URLs only for the blobs it does not already hold.
     */
    fileUploads?: PublicFileUploadTarget[];
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

/** The backend's answer for one declared public file. */
export interface PublicFileUploadTarget {
    /** The `name` from the package definition. */
    name: string;
    /** Lowercase hex SHA-256 the URL was issued for. */
    sha256: string;
    /**
     * Signed PUT URL for the blob. Absent when the registry already holds this
     * sha256 for the package — an asset that did not change between releases is
     * referenced rather than re-uploaded.
     */
    uploadUrl?: string;
}

/**
 * A public file as it is published in the package definition: the local `path`
 * removed, the content metadata the registry and the renderer need added.
 *
 * The published entry deliberately keeps its `name`: references elsewhere in
 * the package (an onboarding v2 image block's `file`) are resolved by name, not
 * by URL, so the name has to survive into the published definition.
 */
export interface PublishedPublicFile extends Omit<EnergyAppPackagePublicFile, 'path'> {
    /** Lowercase hex SHA-256 of the file content. */
    sha256: string;
    /** Size of the file in bytes. */
    sizeBytes: number;
    /** Basename of the declared local path, e.g. `dip-switches.png`. */
    fileName: string;
    /** IANA MIME type; the declared `mimeType` wins over the extension. */
    mimeType: string;
}

/** A declared public file resolved on disk, fingerprinted and ready to upload. */
export interface PreparedPublicFile {
    /** The `name` from the package definition. */
    name: string;
    /** The `path` exactly as declared in the package definition. */
    declaredPath: string;
    /** The declared path resolved against the package root. */
    absolutePath: string;
    sha256: string;
    sizeBytes: number;
    fileName: string;
    mimeType: string;
    /** The form this entry takes in the published definition. */
    published: PublishedPublicFile;
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

export interface OnboardingSimOptions extends CommandOptions {
    /** Bundle entry point, when it is not the usual `dist/index.js`. */
    entry?: string;
    /** Run `npx rsbuild build` before loading the app. */
    build?: boolean;
    /** Let the app reach the network instead of blocking `useFetch()`. */
    allowNetwork?: boolean;
    /** Print the guides the app returned and exit, without serving the UI. */
    print?: boolean;
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