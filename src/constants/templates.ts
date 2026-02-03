import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../templates');

export function getTemplate(name: string): string {
    return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

// For backwards compatibility
export const RS_BUILD_CONFIG = () => getTemplate('rsbuild.config.ts');
export const TS_CONFIG = () => getTemplate('tsconfig.json');
export const EXAMPLE_INDEX_FILE = () => getTemplate('index.ts');
export const EXAMPLE_PACKAGE_FILE = () => getTemplate('energy-app.package.ts');
