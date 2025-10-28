const https = require('https');

function getVideoStatus(videoId, apiKey = process.env.HEYGEN_API_KEY) {
    return new Promise((resolve, reject) => {
        if (!apiKey) {
            reject(new Error('HEYGEN_API_KEY is not configured'));
            return;
        }
        if (!videoId) {
            reject(new Error('videoId is required'));
            return;
        }

        const url = `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`;
        const req = https.request(url, {
            method: 'GET',
            headers: {
                'X-Api-Key': apiKey
            }
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body || '{}');
                    resolve(json);
                } catch (e) {
                    reject(new Error('Invalid JSON from Heygen'));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

module.exports = {
    getVideoStatus
};


