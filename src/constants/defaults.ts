export const DEFAULT_REGISTRY_URL = 'https://api.connect-ems.com';
export const DEFAULT_DEVICE_HOST = 'localhost';
export const DEFAULT_DEVICE_PORT = 6021;
export const MOCK_SERVER_PORT = 4001;

export const FILE_NAMES = {
    PACKAGE_CONFIG: 'connect-ems.package.ts',
    PACKAGE_JSON: 'package.json',
    RSBUILD_CONFIG: 'rsbuild.config.ts',
    TSCONFIG: 'tsconfig.json',
    BUNDLE: 'bundle.tar.gz',
    DIST_INDEX: 'dist/index.js',
    DIST_MAIN: 'dist/main.js',
    SRC_DIR: 'src',
    SRC_INDEX: 'src/index.ts',
} as const;

export const PACKAGE_DEPENDENCIES = '@rsbuild/core @types/node typescript';

export const PORT_VALIDATION = {
    MIN: 1,
    MAX: 65535,
} as const;