export interface NetworkPermissionConfig {
    origins?: string[];
}

export const createRestrictedFetch = (config?: NetworkPermissionConfig) => {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        // If no network permissions are configured, block all requests
        if (!config || !config.origins || config.origins.length === 0) {
            throw new Error('Network access denied: No network permissions configured');
        }

        if (input instanceof Request) {
            input = input.url;
        }
        // Parse the URL
        let url: URL;
        try {
            url = new URL(input.toString());
        } catch (error) {
            throw new Error(`Invalid URL: ${input.toString()}`);
        }

        // Check if the origin is allowed
        const requestOrigin = `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
        const isOriginAllowed = config.origins.some(allowedOrigin => {
            // Support exact match and wildcard patterns
            if (allowedOrigin === '*') {
                return true;
            }

            // Exact match
            if (requestOrigin === allowedOrigin) {
                return true;
            }

            // Allow hostname without port if default port
            if (allowedOrigin === url.hostname &&
                ((url.protocol === 'https:' && url.port === '443') ||
                    (url.protocol === 'http:' && url.port === '80') ||
                    !url.port)) {
                return true;
            }

            return false;
        });

        if (!isOriginAllowed) {
            throw new Error(`Network access denied: Origin '${requestOrigin}' is not in the allowed origins list: [${config.origins.join(', ')}]`);
        }

        // Log the allowed request
        console.log(`Fetch request allowed to: ${url.toString()}`);

        // Make the actual fetch request
        return fetch(input, init);
    };
};