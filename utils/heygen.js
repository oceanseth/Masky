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

    async requestJson(path, options = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                const apiKey = await this.initialize();
                const url = `https://api.heygen.com${path}`;
                const payload = options.body ? JSON.stringify(options.body) : null;
                const req = https.request(url, {
                    method: options.method || 'GET',
                    headers: {
                        'X-Api-Key': apiKey,
                        'Accept': 'application/json',
                        ...(payload ? { 'Content-Type': 'application/json' } : {})
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body || '{}');
                            if (res.statusCode && res.statusCode >= 400) {
                                const err = new Error(json?.message || json?.error || `HeyGen request failed (${res.statusCode})`);
                                try { err.details = json; } catch {}
                                reject(err);
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            reject(new Error('Invalid JSON from Heygen'));
                        }
                    });
                });
                req.on('error', reject);
                if (payload) req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    async listAvatars() {
        // GET /v2/avatars
        const json = await this.requestJson('/v2/avatars', { method: 'GET' });
        return json?.data?.avatars || [];
    }

    async listVoices() {
        // GET /v2/voices
        const json = await this.requestJson('/v2/voices', { method: 'GET' });
        return json?.data?.voices || [];
    }

    async videoList(token) {
        const path = token ? `/v1/video.list?token=${encodeURIComponent(token)}` : '/v1/video.list';
        const json = await this.requestJson(path, { method: 'GET' });
        return json;
    }

    async uploadAssetFromUrl(url) {
        // POST /v2/asset/upload with body { url }
        const json = await this.requestJson('/v2/asset/upload', { method: 'POST', body: { url } });
        const assetId = json?.data?.asset_id || json?.data?.id;
        if (!assetId) throw new Error('Failed to upload asset to HeyGen');
        return assetId;
    }

    async createFolder(name, parentId) {
        // POST /v1/folder/create
        const body = parentId ? { name, parent_id: parentId } : { name };
        const json = await this.requestJson('/v1/folder/create', { method: 'POST', body });
        const folderId = json?.data?.folder_id || json?.data?.id;
        if (!folderId) throw new Error('Failed to create HeyGen folder');
        return folderId;
    }

    async createPhotoAvatarGroup(name) {
        // POST /v2/photo_avatar/avatar_group/create
        const json = await this.requestJson('/v2/photo_avatar/avatar_group/create', { method: 'POST', body: { name } });
        const groupId = json?.data?.avatar_group_id || json?.data?.id;
        if (!groupId) throw new Error('Failed to create photo avatar group');
        return groupId;
    }

    async addLooksToPhotoAvatarGroup(groupId, looks) {
        // looks: array of { url }
        const json = await this.requestJson('/v2/photo_avatar/avatar_group/add', { method: 'POST', body: { avatar_group_id: groupId, looks } });
        return json?.data || json;
    }

    async listAvatarsInAvatarGroup(groupId) {
        const path = `/v2/photo_avatar/avatar_group/avatars?avatar_group_id=${encodeURIComponent(groupId)}`;
        const json = await this.requestJson(path, { method: 'GET' });
        return json?.data?.avatars || [];
    }

    async trainPhotoAvatarGroup(groupId) {
        if (!groupId) throw new Error('groupId is required for training');
        const json = await this.requestJson('/v2/photo_avatar/train', {
            method: 'POST',
            body: { avatar_group_id: groupId }
        });
        // API may return various identifiers; surface the whole data for debugging
        return json?.data || json;
    }

    async getTrainingJobStatus(groupId) {
        if (!groupId) throw new Error('groupId is required for training status');
        const path = `/v2/photo_avatar/train/status/${encodeURIComponent(groupId)}`;
        const json = await this.requestJson(path, { method: 'GET' });
        return json?.data || json;
    }

    async generateVideoWithAudio(params) {
        const {
            avatarId,
            audioUrl,
            width = 1280,
            height = 720,
            avatarStyle = 'normal'
        } = params || {};

        if (!avatarId) throw new Error('avatarId is required');
        if (!audioUrl) throw new Error('audioUrl is required');

        const body = {
            video_inputs: [
                {
                    character: {
                        type: 'avatar',
                        avatar_id: avatarId,
                        avatar_style: avatarStyle
                    },
                    voice: {
                        type: 'audio',
                        audio_url: audioUrl
                    }
                }
            ],
            dimension: {
                width,
                height
            }
        };

        // POST /v2/video/generate
        const json = await this.requestJson('/v2/video/generate', { method: 'POST', body });
        const videoId = json?.data?.video_id || json?.data?.id || json?.data?.videoId;
        if (!videoId) throw new Error('Failed to retrieve video_id from HeyGen');
        return videoId;
    }

    async generateVideoWithAudioAsset(params) {
        const {
            avatarId,
            audioAssetId,
            width = 1280,
            height = 720,
            avatarStyle = 'normal',
            title,
            callbackId,
            folderId
        } = params || {};

        if (!avatarId) throw new Error('avatarId is required');
        if (!audioAssetId) throw new Error('audioAssetId is required');

        const body = {
            title,
            callback_id: callbackId,
            folder_id: folderId,
            video_inputs: [
                {
                    character: {
                        type: 'avatar',
                        avatar_id: avatarId,
                        avatar_style: avatarStyle
                    },
                    voice: {
                        type: 'audio',
                        audio_asset_id: audioAssetId
                    }
                }
            ],
            dimension: {
                width,
                height
            }
        };

        const json = await this.requestJson('/v2/video/generate', { method: 'POST', body });
        const videoId = json?.data?.video_id || json?.data?.id || json?.data?.videoId;
        if (!videoId) throw new Error('Failed to retrieve video_id from HeyGen');
        return videoId;
    }
}

module.exports = new HeygenClient();


