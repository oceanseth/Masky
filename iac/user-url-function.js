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
    var excludedPaths = ['/api', '/assets', '/src', '/favicon.ico', '/index.html', '/membership.html', '/twitchevent.html', '/user.html'];
    var hasExtension = /\.([a-zA-Z0-9]+)$/.test(uri.split('?')[0]);
    var isExcluded = excludedPaths.some(function(path) {
        return uri === path || uri.startsWith(path + '/');
    });
    
    // Match pattern: /{username} (single path segment, no leading/trailing slashes except the first one)
    var userUrlPattern = /^\/([^\/]+)$/;
    
    if (userUrlPattern.test(uri) && !isExcluded && !hasExtension) {
        // Rewrite to /user.html while preserving query string
        var queryString = request.querystring ? '?' + request.querystring : '';
        request.uri = '/user.html' + queryString;
        return request;
    }
    
    // Otherwise, return the request unchanged
    return request;
}

