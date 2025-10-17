function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var host = headers.host.value;
    
    // If the host is www.masky.net, redirect to masky.net
    if (host === 'www.masky.net') {
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                'location': { value: 'https://masky.net' + request.uri }
            }
        };
    }
    
    // Otherwise, return the request unchanged
    return request;
}

