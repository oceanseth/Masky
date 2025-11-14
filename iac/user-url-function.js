function handler(event) {
    var request = event.request;
    var uri = request.uri;
    var headers = request.headers;
    var host = headers.host.value;
    
    // Redirect www.masky.ai to masky.ai
    if (host === 'www.masky.ai') {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://masky.ai' + uri }
            }
        };
    }
    
    // Redirect any masky.net hostnames to masky.ai
    if (host === 'www.masky.net' || host === 'masky.net') {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://masky.ai' + uri }
            }
        };
    }
    
    // Rewrite user URLs (/{username}) to /user.html
    // Pattern: /{username} where username doesn't contain slashes and isn't a file
    // Exclude known paths and files with extensions
    // Extract pathname (remove query string)
    var pathname = uri.split('?')[0];
    
    // Don't treat root path (/) as a username
    if (pathname === '/') {
        return request;
    }
    
    var excludedPaths = ['/api', '/assets', '/src', '/favicon.ico', '/index.html', '/membership.html', '/twitchevent.html', '/user.html'];
    var hasExtension = /\.([a-zA-Z0-9]+)$/.test(pathname);
    var isExcluded = excludedPaths.some(function(path) {
        return pathname === path || pathname.startsWith(path + '/');
    });
    
    // Match pattern: /{username} (single path segment, no leading/trailing slashes except the first one)
    var userUrlPattern = /^\/([^\/]+)$/;
    
    if (userUrlPattern.test(pathname) && !isExcluded && !hasExtension) {
        // Rewrite to /user.html while preserving query string
        // Note: querystring is preserved automatically as a separate object property
        request.uri = '/user.html';
        return request;
    }
    
    // Otherwise, return the request unchanged
    return request;
}

