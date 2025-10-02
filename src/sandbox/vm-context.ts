import vm from 'vm';
import { ConnectEmsApiImplementation, ConnectEmsApiContext } from '../connect-ems-api-implementation.js';
import { createRestrictedFS } from './restricted-fs.js';
import { createRestrictedRequire } from './restricted-require.js';
import { createRestrictedProcess } from './restricted-process.js';
import { createRestrictedFetch, NetworkPermissionConfig } from './restricted-fetch.js';

export interface VMSandboxConfig {
    packageDir: string;
    packageRoot: string;
    distPath: string;
    context: ConnectEmsApiContext;
    networkConfig?: NetworkPermissionConfig;
    permissions?: string[];
}

export const createVMContext = (config: VMSandboxConfig) => {
    const { packageDir, packageRoot, distPath, context, networkConfig, permissions } = config;

    // Add permissions to the context
    const contextWithPermissions = {
        ...context,
        permissions: permissions || []
    };

    // Create restricted components
    const restrictedFS = createRestrictedFS(packageRoot);
    const restrictedProcess = createRestrictedProcess(packageRoot);
    const restrictedFetch = createRestrictedFetch(networkConfig);
    const restrictedRequire = createRestrictedRequire(restrictedFS, packageRoot, distPath, restrictedFetch);

    // Create the sandbox with restricted access
    const sandbox = vm.createContext({
        console,
        require: restrictedRequire,
        __dirname: packageDir,
        __filename: distPath,
        process: restrictedProcess,
        fetch: restrictedFetch,
        Buffer,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        setImmediate,
        clearImmediate,
        global: undefined, // Will be set to the sandbox itself
        exports: {},
        module: {
            exports: {},
            require: restrictedRequire,
            id: distPath,
            filename: distPath,
            loaded: false,
            parent: null,
            children: []
        },
        connectEmsApi: new ConnectEmsApiImplementation(contextWithPermissions, restrictedFetch)
    });

    // Set global to point to the sandbox itself
    sandbox.global = sandbox;

    return sandbox;
};