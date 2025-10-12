import fs from 'fs';
import path from 'path';
import {createJiti} from 'jiti';
import type {ConnectPackageDefinition} from "../../../connect-ems-api";
import {FILE_NAMES} from '../constants/defaults.js';
import {CLIError} from './error-handler.js';

export const readConnectEmsPackageConfig = async (filePath = FILE_NAMES.PACKAGE_CONFIG): Promise<ConnectPackageDefinition> => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new CLIError(`${FILE_NAMES.PACKAGE_CONFIG} file not found at ${filePath}`);
        }

        const jiti = createJiti(path.resolve(`./${filePath}`), {
            interopDefault: true,
            transformOptions: {
                // @ts-expect-error this is fine
                typescript: true
            }
        });

        return (await jiti(path.resolve(filePath))).default as ConnectPackageDefinition;
    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }

        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new CLIError(`Error reading ${FILE_NAMES.PACKAGE_CONFIG}: ${message}`);
    }
};

export const ensureFileExists = (filePath: string, description: string): void => {
    if (!fs.existsSync(filePath)) {
        throw new CLIError(`${description} not found at ${filePath}`);
    }
};

export const writeFileIfNotExists = (filePath: string, content: string): void => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content);
    }
};

export const ensureDirectoryExists = (dirPath: string): void => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true});
    }
};