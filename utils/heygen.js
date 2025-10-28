const https = require('https');
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });

class HeygenClient {
    constructor() {
        this.ssm = new AWS.SSM();
        this.apiKey = null;
    }

    async initialize() {
        if (this.apiKey) return this.apiKey;

        const stage = process.env.STAGE || 'production';
        const params = {
            Name: `/masky/${stage}/heygen_api_key`,
            WithDecryption: true
        };

        const result = await this.ssm.getParameter(params).promise();
        if (!result?.Parameter?.Value) {
            throw new Error('Heygen API key not found in SSM');
        }

        this.apiKey = result.Parameter.Value;
        return this.apiKey;
    }

    async getVideoStatus(videoId) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!videoId) {
                    reject(new Error('videoId is required'));
                    return;
                }

                const apiKey = await this.initialize();
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
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = new HeygenClient();


