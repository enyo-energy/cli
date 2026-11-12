import {CLIError} from './error-handler.js';

/**
 * One JSON call to the enyo registry with the developer org's API key.
 * A refusal throws with the registry's own message — for the device commands
 * that is what tells a developer *why* (an external org, an unknown box).
 */
export const registryRequest = async <T>(
    url: string,
    apiKey: string,
    init: {method: 'GET' | 'POST' | 'PUT'; body?: unknown},
    context: string
): Promise<T> => {
    const response = await fetch(url, {
        method: init.method,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...(init.body !== undefined ? {'Content-Type': 'application/json'} : {})
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });

    if (!response.ok) {
        const message = await readErrorMessage(response);
        throw new CLIError(`${context} failed: ${response.status}${message ? ` — ${message}` : ''}`);
    }

    return await response.json() as T;
};

/** The `message` of a NestJS error body, or the raw text when it is not one. */
export const readErrorMessage = async (response: Response): Promise<string> => {
    const text = await response.text().catch(() => '');
    try {
        const body = JSON.parse(text) as {message?: string | string[]};
        if (Array.isArray(body.message)) {
            return body.message.join(', ');
        }
        return body.message ?? text;
    } catch {
        return text;
    }
};
