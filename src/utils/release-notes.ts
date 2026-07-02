import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import {CLIError} from './error-handler.js';
import type {ReleaseNote} from '../types';

/**
 * Build the `releaseNote` payload array from optional DE/EN strings,
 * dropping any language whose note is empty.
 */
const buildReleaseNotes = (de?: string, en?: string): ReleaseNote[] | undefined => {
    const notes: ReleaseNote[] = [];
    if (de && de.trim()) {
        notes.push({language: 'de', note: de.trim()});
    }
    if (en && en.trim()) {
        notes.push({language: 'en', note: en.trim()});
    }
    return notes.length > 0 ? notes : undefined;
};

/**
 * Read release notes from a JSON file of the shape { de?: string, en?: string }.
 */
const readReleaseNotesFile = (filePath: string): ReleaseNote[] | undefined => {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new CLIError(`Release notes file not found at: ${resolved}`);
    }

    let parsed: {de?: string; en?: string};
    try {
        parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } catch (error: any) {
        throw new CLIError(`Failed to parse release notes file ${resolved}: ${error.message}`);
    }

    console.log(`📝 Using release notes from ${filePath}`);
    return buildReleaseNotes(parsed.de, parsed.en);
};

/**
 * Prompt the user interactively for DE and EN release notes. Pressing Enter skips a field.
 */
const promptReleaseNotes = async (): Promise<ReleaseNote[] | undefined> => {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    try {
        console.log('📝 Optionally add release notes (press Enter to skip a field):');
        const de = await rl.question('   🇩🇪 Release notes (DE): ');
        const en = await rl.question('   🇬🇧 Release notes (EN): ');
        return buildReleaseNotes(de, en);
    } finally {
        rl.close();
    }
};

/**
 * Collect release notes once, shared across all package configs.
 * - If a file path is given, read notes from that JSON file.
 * - Else, if running interactively, prompt for DE/EN notes.
 * - Otherwise (e.g. CI without a file), return undefined.
 */
export const collectReleaseNotes = async (filePath?: string): Promise<ReleaseNote[] | undefined> => {
    if (filePath) {
        return readReleaseNotesFile(filePath);
    }

    if (process.stdin.isTTY) {
        return promptReleaseNotes();
    }

    console.log('ℹ️ No release notes provided (non-interactive, no --release-notes file).');
    return undefined;
};
