import fs from 'fs';
import path from 'path';
import {encryptSecret} from '../utils/encryption.js';
import {CLIError} from '../utils/error-handler.js';
import type {SecretCommandOptions, SecretRequest} from '../types';
import {DEFAULT_REGISTRY_URL} from "../constants/defaults.js";

async function saveSecret(name: string, encryptedSecret: string, token: string, registryUrl: string, channel: 'production' | 'staging'): Promise<void> {
    const url = `${registryUrl}/api/secret-management/secret`;

    const body: SecretRequest = {
        name,
        encryptedSecret,
        channel
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new CLIError(`Failed to save secret: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Secret '${name}' saved successfully!`);
}

function readJsonFile(filePath: string): string {
    try {
        const absolutePath = path.resolve(filePath);

        if (!fs.existsSync(absolutePath)) {
            throw new CLIError(`File not found: ${absolutePath}`);
        }

        const fileContent = fs.readFileSync(absolutePath, 'utf8');

        // Parse to validate it's valid JSON
        const jsonData = JSON.parse(fileContent);

        // Return stringified JSON with proper formatting
        return JSON.stringify(jsonData, null, 2);
    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        if (error instanceof SyntaxError) {
            throw new CLIError(`Invalid JSON in file: ${filePath}`);
        }
        throw new CLIError(`Failed to read file: ${error as Error}`);
    }
}

export async function secretCommand(options: SecretCommandOptions): Promise<void> {
    try {
        if (!options.name) {
            throw new CLIError('Secret name is required. Use --name <name>');
        }

        if (!options.apiKey) {
            throw new CLIError('Developer Org API Key is required. Use --api-key <apiKey>');
        }

        if (!options.secret) {
            throw new CLIError('Master secret is required for encryption. Use --secret <secret>');
        }

        // Check that either value or file is provided, but not both
        if (!options.value && !options.file) {
            throw new CLIError('Secret value is required. Use either --value <value> or --file <path>');
        }

        if (options.value && options.file) {
            throw new CLIError('Cannot use both --value and --file options. Choose one.');
        }

        let secretValue: string;

        if (options.file) {
            console.log(`📁 Reading JSON file: ${options.file}`);
            secretValue = readJsonFile(options.file);
        } else {
            secretValue = options.value!;
        }

        console.log('🔐 Encrypting secret...');
        const encryptedSecret = encryptSecret(secretValue, options.secret);

        const channel = options.channel || 'production';
        if (channel !== 'production' && channel !== 'staging') {
            throw new CLIError('Channel must be either "production" or "staging"');
        }

        console.log('📤 Saving encrypted secret to server...');
        await saveSecret(options.name, encryptedSecret, options.apiKey, options.registry || DEFAULT_REGISTRY_URL, channel);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        throw new CLIError(`Failed to manage secret: ${error as Error}`);
    }
}