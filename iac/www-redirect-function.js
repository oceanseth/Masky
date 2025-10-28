function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var host = headers.host.value;
    
    // Redirect www.masky.ai to masky.ai
    if (host === 'www.masky.ai') {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://masky.ai' + request.uri }
            }
        };
    }
    
    // Redirect any masky.net hostnames to masky.ai
    if (host === 'www.masky.net' || host === 'masky.net') {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://masky.ai' + request.uri }
            }
        };
    }
    
    // Otherwise, return the request unchanged
    return request;
}

