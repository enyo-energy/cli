import { execSync } from 'child_process';
import { RS_BUILD_CONFIG, TS_CONFIG, EXAMPLE_INDEX_FILE, EXAMPLE_PACKAGE_FILE } from '../constants/templates.js';
import { FILE_NAMES, PACKAGE_DEPENDENCIES } from '../constants/defaults.js';
import { CLIError, handleError } from '../utils/error-handler.js';
import { writeFileIfNotExists, ensureDirectoryExists, ensureFileExists } from '../utils/file-utils.js';

export const initCommand = (): void => {
    try {
        ensureFileExists(FILE_NAMES.PACKAGE_JSON, 'package.json');

        writeFileIfNotExists(FILE_NAMES.RSBUILD_CONFIG, RS_BUILD_CONFIG);
        writeFileIfNotExists(FILE_NAMES.TSCONFIG, TS_CONFIG);

        ensureDirectoryExists(FILE_NAMES.SRC_DIR);
        writeFileIfNotExists(FILE_NAMES.SRC_INDEX, EXAMPLE_INDEX_FILE);
        writeFileIfNotExists(FILE_NAMES.PACKAGE_CONFIG, EXAMPLE_PACKAGE_FILE);

        console.log('📦 Installing dependencies...');
        execSync(`npm install -D ${PACKAGE_DEPENDENCIES}`, { stdio: 'inherit' });

        console.log('✅ enyo package initialized successfully!');
        console.log('📝 Files created:');
        console.log(`  - ${FILE_NAMES.RSBUILD_CONFIG}`);
        console.log(`  - ${FILE_NAMES.TSCONFIG}`);
        console.log(`  - ${FILE_NAMES.SRC_INDEX}`);
        console.log(`  - ${FILE_NAMES.PACKAGE_CONFIG}`);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'during package initialization');
    }
};