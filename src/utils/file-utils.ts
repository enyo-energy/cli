import fs from 'fs';
import path from 'path';
import {createJiti} from 'jiti';
import {FILE_NAMES} from '../constants/defaults.js';
import {CLIError} from './error-handler.js';
import {EnergyAppPackageDefinition} from "@hems-one/energy-app-sdk";

export const readEnyoPackageConfig = async (filePath: string = FILE_NAMES.PACKAGE_CONFIG): Promise<EnergyAppPackageDefinition> => {
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

        return (await jiti(path.resolve(filePath))).default as EnergyAppPackageDefinition;
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

export const findPackageConfigs = (): string[] => {
    const currentDir = process.cwd();
    const files = fs.readdirSync(currentDir);
    return files.filter(file => file.endsWith('.package.ts'));
};

export const readAndValidatePackageConfig = async (filePath: string): Promise<EnergyAppPackageDefinition | null> => {
    try {
        return await readEnyoPackageConfig(filePath);
    } catch (error) {
        console.warn(`⚠️ Skipping invalid config file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
};