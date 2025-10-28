function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var host = headers.host.value;
    
    // If the host is www.masky.ai, redirect to masky.ai
    if (host === 'www.masky.ai') {
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

