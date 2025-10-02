/**
 * Error thrown when a required permission is not granted in the package configuration
 */
export class PermissionNotGrantedError extends Error {
    constructor(
        public readonly requiredPermission: string,
        public readonly availablePermissions: string[]
    ) {
        super(
            `Permission '${requiredPermission}' is required but not granted. ` +
            `Available permissions: [${availablePermissions.join(', ')}]`
        );
        this.name = 'PermissionNotGrantedError';
    }
}