export const DEFAULT_REGISTRY_URL = 'https://api.enyo-energy.de';
/** The simulation runtime — where `enyo simulator` keeps the org's device simulators. */
export const DEFAULT_SIMULATION_RUNTIME_URL = 'https://runtime-mac-mini-01.enyo.energy';
export const DEFAULT_DEVICE_HOST = 'localhost';
export const DEFAULT_DEVICE_PORT = 443;

export const FILE_NAMES = {
    PACKAGE_CONFIG: 'energy-app.package.ts',
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