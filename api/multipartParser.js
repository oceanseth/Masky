/**
 * Simple multipart form data parser for file uploads
 * This is a basic implementation - in production, consider using a library like 'busboy' or 'formidable'
 */

function parseMultipartData(body, boundary) {
    if (!body || !boundary) {
        throw new Error('Invalid multipart data');
    }

    const parts = body.split(`--${boundary}`);
    const files = [];
    const fields = {};

    for (const part of parts) {
        if (part.trim() === '' || part.trim() === '--') {
            continue;
        }

        const [headers, ...contentParts] = part.split('\r\n\r\n');
        const content = contentParts.join('\r\n\r\n').replace(/\r\n$/, '');

        if (!headers || !content) {
            continue;
        }

        const headerLines = headers.split('\r\n');
        const dispositionHeader = headerLines.find(line => 
            line.toLowerCase().startsWith('content-disposition:')
        );

        if (!dispositionHeader) {
            continue;
        }

        // Parse Content-Disposition header
        const dispositionMatch = dispositionHeader.match(/name="([^"]+)"(?:; filename="([^"]+)")?/);
        if (!dispositionMatch) {
            continue;
        }

        const fieldName = dispositionMatch[1];
        const fileName = dispositionMatch[2];

        if (fileName) {
            // This is a file
            const contentTypeHeader = headerLines.find(line => 
                line.toLowerCase().startsWith('content-type:')
            );
            const contentType = contentTypeHeader ? 
                contentTypeHeader.split(': ')[1] : 'application/octet-stream';

            files.push({
                fieldName,
                fileName,
                contentType,
                data: Buffer.from(content, 'binary')
            });
        } else {
            // This is a regular field
            fields[fieldName] = content;
        }
    }

    return { files, fields };
}

module.exports = { parseMultipartData };
