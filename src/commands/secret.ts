import fs from 'fs';
import path from 'path';
import {encryptSecret} from '../utils/encryption.js';
import {CLIError} from '../utils/error-handler.js';
import type {SecretCommandOptions, SecretRequest} from '../types';

async function saveSecret(name: string, encryptedSecret: string, token: string): Promise<void> {
    const url = 'https://api.enyo-energy.de/api/secret-management/secret';

    const body: SecretRequest = {
        name,
        encryptedSecret
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

        if (!options.token) {
            throw new CLIError('Developer Org Access Token is required. Use --token <token>');
        }

        if (!options.masterSecret) {
            throw new CLIError('Master secret is required for encryption. Use --master-secret <secret>');
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
        const encryptedSecret = encryptSecret(secretValue, options.masterSecret);

        console.log('📤 Saving encrypted secret to server...');
        await saveSecret(options.name, encryptedSecret, options.token);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        throw new CLIError(`Failed to manage secret: ${error as Error}`);
    }
}