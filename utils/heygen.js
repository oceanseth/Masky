const https = require('https');
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });
const firebaseInitializer = require('./firebaseInit');

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const DEFAULT_PLAN_MAX_DIMENSION = (() => {
    const envValue = Number(process.env.HEYGEN_PLAN_MAX_DIMENSION || process.env.HEYGEN_MAX_DIMENSION);
    if (Number.isFinite(envValue) && envValue > 0) {
        return envValue;
    }
    return 1280;
})();

const PLAN_NAME_DIMENSION_MAP = {
    free: 1280,
    starter: 1280,
    basic: 1280,
    hobby: 1280,
    creator: 1920,
    standard: 1920,
    pro: 1920,
    business: 3840,
    enterprise: 3840
};

// Note: Local environment is loaded in api/api.js handler
// No need to load again here

// Note: Image conversion (WebP to JPEG/PNG) is now handled client-side before upload
// This avoids the need for sharp and platform-specific binaries on Lambda

class HeygenClient {
    constructor() {
        this.ssm = new AWS.SSM();
        this.apiKey = null;
        this.cachedPlanMaxDimension = null;
        this.planInfoLastFetchedAt = null;
        this.planInfoFetchFailed = false;
    }

    async initialize() {
        if (this.apiKey) return this.apiKey;

        // Check if running locally
        if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
            console.log('🔧 Running in local mode - loading HeyGen from environment');
            
            if (!process.env.HEYGEN_API_KEY) {
                throw new Error('HEYGEN_API_KEY not found in .env.local. Please copy env.local.example to .env.local and fill in your credentials.');
            }

            this.apiKey = process.env.HEYGEN_API_KEY;
            return this.apiKey;
        } else {
            // Production mode - load from SSM
            console.log('☁️  Loading HeyGen from SSM...');
            
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
                console.log(`[requestJson] ${options.method || 'GET'} ${url}`);
                if (payload) {
                    console.log('[requestJson] Request body:', payload);
                }
                const req = https.request(url, {
                    method: options.method || 'GET',
                    headers: {
                        'X-Api-Key': apiKey,
                        'Accept': 'application/json',
                        ...(payload ? { 'Content-Type': 'application/json' } : {})
                    }
                }, (res) => {
                    console.log(`[requestJson] Response status: ${res.statusCode} for ${path}`);
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body || '{}');
                            if (res.statusCode && res.statusCode >= 400) {
                                // Extract error message from various possible locations
                                const errorMsg = json?.error?.message || json?.message || json?.error || `HeyGen request failed (${res.statusCode})`;
                                const err = new Error(errorMsg);
                                try { err.details = json; } catch {}
                                console.error(`[requestJson] Error response (${res.statusCode}):`, JSON.stringify(json, null, 2));
                                reject(err);
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            console.error('[requestJson] Failed to parse JSON response');
                            console.error('[requestJson] Status code:', res.statusCode);
                            console.error('[requestJson] Response headers:', res.headers);
                            console.error('[requestJson] Raw response body:', body);
                            console.error('[requestJson] Response body length:', body?.length);
                            console.error('[requestJson] Parse error:', e.message);
                            const err = new Error(`Invalid JSON from Heygen. Status: ${res.statusCode}, Body: ${body?.substring(0, 500)}`);
                            err.statusCode = res.statusCode;
                            err.rawBody = body;
                            reject(err);
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
        return await this.requestJson(path, { method: 'GET' });
    }

    async uploadAssetFromUrl(url) {
        // HeyGen upload endpoint: https://upload.heygen.com/v1/asset
        // It requires file upload, not URL, so we need to download the file first
        console.log('[uploadAssetFromUrl] Starting upload for URL:', url);
        
        try {
            // Download the file from the URL
            console.log('[uploadAssetFromUrl] Downloading file from URL...');
            let fileResponse;
            let actualContentType;
            await new Promise((resolve, reject) => {
                https.get(url, (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Failed to download file: ${res.statusCode}`));
                        return;
                    }
                    actualContentType = res.headers['content-type'] || '';
                    const chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => {
                        fileResponse = Buffer.concat(chunks);
                        resolve();
                    });
                    res.on('error', reject);
                }).on('error', reject);
            });
            
            console.log('[uploadAssetFromUrl] File downloaded, size:', fileResponse.length, 'bytes, content-type:', actualContentType);
            
            // Determine content type from URL or response headers
            // Note: WebP conversion is now handled client-side before upload
            let contentType = 'image/jpeg'; // default
            
            if (actualContentType.includes('png') || url.includes('.png')) {
                contentType = 'image/png';
            } else if (actualContentType.includes('jpeg') || actualContentType.includes('jpg') || 
                       url.includes('.jpg') || url.includes('.jpeg')) {
                contentType = 'image/jpeg';
            } else if (actualContentType.includes('webp') || url.includes('.webp')) {
                // WebP should have been converted client-side, but if we still get one, reject it
                console.warn('[uploadAssetFromUrl] Received WebP image - should have been converted client-side');
                throw new Error('WebP images are not supported. Please convert to JPEG or PNG before uploading.');
            }
            
            const imageBuffer = fileResponse;
            
            console.log('[uploadAssetFromUrl] Final content-type:', contentType, 'size:', imageBuffer.length, 'bytes');
            
            // Upload to HeyGen
            const apiKey = await this.initialize();
            const uploadUrl = 'https://upload.heygen.com/v1/asset';
            console.log('[uploadAssetFromUrl] Uploading to:', uploadUrl);
            
            const json = await new Promise((resolve, reject) => {
                const req = https.request(uploadUrl, {
                    method: 'POST',
                    headers: {
                        'X-Api-Key': apiKey,
                        'Content-Type': contentType
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body || '{}');
                            if (res.statusCode && res.statusCode >= 400) {
                                const errorMsg = json?.error?.message || json?.message || json?.error || `Upload failed (${res.statusCode})`;
                                const err = new Error(errorMsg);
                                err.details = json;
                                reject(err);
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            console.error('[uploadAssetFromUrl] Failed to parse response:', body);
                            reject(new Error(`Invalid JSON from HeyGen upload. Status: ${res.statusCode}, Body: ${body?.substring(0, 500)}`));
                        }
                    });
                });
                req.on('error', reject);
                req.write(imageBuffer);
                req.end();
            });
            
            console.log('[uploadAssetFromUrl] Full response:', JSON.stringify(json, null, 2));
            
            // Try multiple possible field names for image_key
            const assetId = json?.image_key || 
                           json?.id || 
                           json?.data?.image_key ||
                           json?.data?.id ||
                           json?.data?.asset_id;
            
            console.log('[uploadAssetFromUrl] Extracted assetId/image_key:', assetId);
            console.log('[uploadAssetFromUrl] All possible fields:', Object.keys(json || {}));
            
            if (!assetId) {
                console.error('[uploadAssetFromUrl] FAILED - No image_key found in response');
                console.error('[uploadAssetFromUrl] Full response structure:', JSON.stringify(json, null, 2));
                throw new Error(`Failed to upload asset to HeyGen. No image_key in response. Response: ${JSON.stringify(json)}`);
            }
            
            console.log('[uploadAssetFromUrl] SUCCESS - Returning image_key:', assetId);
        return assetId;
        } catch (err) {
            console.error('[uploadAssetFromUrl] ERROR during upload:', err);
            console.error('[uploadAssetFromUrl] Error details:', err.details || err.message);
            throw err;
        }
    }
    
    async listLooksInPhotoAvatarGroup(groupId) {
        // List avatars in an avatar group
        // HeyGen API endpoint: GET /v2/avatar_group/{group_id}/avatars
        console.log('[listLooksInPhotoAvatarGroup] Listing avatars for group:', groupId);
        try {
            const path = `/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`;
            const json = await this.requestJson(path, { method: 'GET' });
            console.log('[listLooksInPhotoAvatarGroup] Full response:', JSON.stringify(json, null, 2));
            
            // HeyGen returns: { error: null, data: { avatar_list: [...] } }
            let avatars = [];
            
            if (json?.error) {
                console.error('[listLooksInPhotoAvatarGroup] HeyGen API error:', json.error);
                return [];
            }
            
            // Check for avatar_list in data
            if (json?.data?.avatar_list && Array.isArray(json.data.avatar_list)) {
                avatars = json.data.avatar_list;
            }
            // Fallback: check if data is an array
            else if (Array.isArray(json?.data)) {
                avatars = json.data;
            }
            // Fallback: check if avatars are at root level
            else if (Array.isArray(json?.avatars)) {
                avatars = json.avatars;
            }
            // Fallback: check for avatar_list at root
            else if (Array.isArray(json?.avatar_list)) {
                avatars = json.avatar_list;
            }
            
            console.log('[listLooksInPhotoAvatarGroup] Extracted avatars:', JSON.stringify(avatars, null, 2));
            console.log('[listLooksInPhotoAvatarGroup] Found', avatars.length, 'avatar(s)');
            
            // Convert avatars to looks format (with image_url)
            const looks = avatars.map(avatar => ({
                id: avatar.id,
                url: avatar.image_url,
                image_url: avatar.image_url,
                name: avatar.name,
                status: avatar.status,
                created_at: avatar.created_at,
                group_id: avatar.group_id,
                is_motion: avatar.is_motion,
                motion_preview_url: avatar.motion_preview_url
            }));
            
            console.log('[listLooksInPhotoAvatarGroup] Converted to looks format:', JSON.stringify(looks, null, 2));
            
            return looks;
        } catch (err) {
            console.error('[listLooksInPhotoAvatarGroup] Failed to list avatars:', err.message);
            console.error('[listLooksInPhotoAvatarGroup] Error details:', err.details || err);
            // Return empty array on error
            return [];
        }
    }

    async createFolder(name, parentId) {
        // POST /v1/folder/create
        const body = parentId ? { name, parent_id: parentId } : { name };
        const json = await this.requestJson('/v1/folder/create', { method: 'POST', body });
        const folderId = json?.data?.folder_id || json?.data?.id;
        if (!folderId) throw new Error('Failed to create HeyGen folder');
        return folderId;
    }

    async createPhotoAvatarGroup(name, imageKeyOrUrl = null) {
        // POST /v2/photo_avatar/avatar_group/create
        // NOTE: HeyGen API requires image_key when creating a group - you cannot create an empty group
        console.log('[createPhotoAvatarGroup] Creating avatar group with name:', name);
        
        let imageKey = imageKeyOrUrl;
        
        // If a URL is provided, upload it first to get image_key
        if (imageKeyOrUrl && imageKeyOrUrl.startsWith('http')) {
            console.log('[createPhotoAvatarGroup] Uploading image URL to get image_key:', imageKeyOrUrl);
            try {
                imageKey = await this.uploadAssetFromUrl(imageKeyOrUrl);
                console.log('[createPhotoAvatarGroup] Got image_key from upload:', imageKey);
            } catch (uploadErr) {
                console.error('[createPhotoAvatarGroup] Failed to upload image:', uploadErr);
                throw new Error(`Failed to upload image for avatar group creation: ${uploadErr.message}`);
            }
        }
        
        // If no image_key provided, we cannot create the group
        if (!imageKey) {
            throw new Error('Cannot create avatar group without image_key. HeyGen API requires at least one image when creating a group.');
        }
        
        const requestBody = { name, image_key: imageKey };
        console.log('[createPhotoAvatarGroup] Request body:', JSON.stringify(requestBody, null, 2));
        
        try {
            const json = await this.requestJson('/v2/photo_avatar/avatar_group/create', { method: 'POST', body: requestBody });
            console.log('[createPhotoAvatarGroup] Full response:', JSON.stringify(json, null, 2));
            console.log('[createPhotoAvatarGroup] Response data:', JSON.stringify(json?.data, null, 2));
            
            const groupId = json?.data?.avatar_group_id || 
                           json?.data?.id || 
                           json?.data?.group_id ||
                           json?.avatar_group_id ||
                           json?.id;
            
            console.log('[createPhotoAvatarGroup] Extracted groupId:', groupId);
            console.log('[createPhotoAvatarGroup] All possible fields in data:', Object.keys(json?.data || {}));
            
            if (!groupId) {
                console.error('[createPhotoAvatarGroup] FAILED - No avatar_group_id found in response');
                console.error('[createPhotoAvatarGroup] Full response structure:', JSON.stringify(json, null, 2));
                throw new Error(`Failed to create photo avatar group. No avatar_group_id in response. Response: ${JSON.stringify(json)}`);
            }
            
            console.log('[createPhotoAvatarGroup] SUCCESS - Created group with ID:', groupId);
        return groupId;
        } catch (err) {
            console.error('[createPhotoAvatarGroup] ERROR during creation:', err);
            console.error('[createPhotoAvatarGroup] Error details:', err.details || err.message);
            throw err;
        }
    }

    async addLooksToPhotoAvatarGroup(groupId, looks, namePrefix = null) {
        // looks: array of { url, name?, assetId? } or { image_key, name?, assetId? }
        // If looks contain URLs, we need to upload them first to get image_key
        // HeyGen API expects 'group_id', 'image_keys', and 'name'
        if (!Array.isArray(looks) || looks.length === 0) {
            throw new Error('Looks must be a non-empty array');
        }
        
        console.log('addLooksToPhotoAvatarGroup called with:', { groupId, looksCount: looks.length, looks, namePrefix });
        
        // Extract image_keys from looks (upload URLs if needed)
        const imageKeys = [];
        
        for (let index = 0; index < looks.length; index++) {
            const look = looks[index];
            console.log(`Processing look ${index}:`, look);
            
            let imageKey = null;
            
            // If look has image_key already, use it
            if (look.image_key) {
                imageKey = look.image_key;
                console.log(`Look ${index} already has image_key:`, imageKey);
            }
            // If look has URL, upload it first to get image_key
            else if (look.url) {
                console.log(`Look ${index} has URL, uploading to get image_key:`, look.url);
                try {
                    imageKey = await this.uploadAssetFromUrl(look.url);
                    console.log(`Look ${index} upload successful, got image_key:`, imageKey);
                } catch (uploadErr) {
                    console.error(`Look ${index} failed to upload asset from URL:`, uploadErr);
                    throw new Error(`Failed to upload image ${index + 1}: ${uploadErr.message || uploadErr}`);
                }
            }
            else {
                throw new Error(`Look ${index + 1} must have either 'url' or 'image_key'`);
            }
            
            if (imageKey) {
                imageKeys.push(imageKey);
            }
        }
        
        console.log('Processed image_keys:', imageKeys);
        
        if (imageKeys.length === 0) {
            throw new Error('No valid image_keys found after processing looks');
        }
        
        // Generate a name for this batch of looks
        // Use the namePrefix if provided, otherwise generate from first look's name or assetId
        let batchName = namePrefix;
        if (!batchName) {
            const firstLook = looks[0];
            batchName = firstLook.name || 
                       firstLook.assetId || 
                       firstLook.fileName ||
                       `avatar_${Date.now()}`;
        }
        
        // HeyGen API expects 'group_id', 'image_keys' (plural, array of strings), and 'name'
        const requestBody = { 
            group_id: groupId, 
            image_keys: imageKeys,
            name: batchName
        };
        const apiUrl = 'https://api.heygen.com/v2/photo_avatar/avatar_group/add';
        const apiMethod = 'POST';
        console.log(`[addLooksToPhotoAvatarGroup] Sending ${apiMethod} request to: ${apiUrl}`);
        console.log('[addLooksToPhotoAvatarGroup] Request body:', JSON.stringify(requestBody, null, 2));
        
        try {
            const json = await this.requestJson('/v2/photo_avatar/avatar_group/add', { 
                method: 'POST', 
                body: requestBody
            });
            
            console.log('[addLooksToPhotoAvatarGroup] HeyGen response:', JSON.stringify(json));
        return json?.data || json;
        } catch (err) {
            // Enhance error with exact API call details
            err.apiCall = {
                method: apiMethod,
                url: apiUrl,
                body: requestBody,
                headers: {
                    'X-Api-Key': '***REDACTED***',
                    'Content-Type': 'application/json'
                }
            };
            console.error('[addLooksToPhotoAvatarGroup] API call that failed:', JSON.stringify(err.apiCall, null, 2));
            throw err;
        }
    }

    async removeLookFromPhotoAvatarGroup(groupId, lookUrl) {
        // Remove a look from photo avatar group by URL
        // Note: HeyGen may not have a direct remove endpoint, so we'll use the delete method
        // If the API requires look_id instead of URL, we'll need to list looks first and match by URL
        // HeyGen API expects 'group_id' not 'avatar_group_id'
        const json = await this.requestJson('/v2/photo_avatar/avatar_group/remove', { 
            method: 'POST', 
            body: { 
                group_id: groupId, 
                looks: [{ url: lookUrl }]
            } 
        });
        return json?.data || json;
    }

    async listAvatarsInAvatarGroup(groupId) {
        const path = `/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`;
        const json = await this.requestJson(path, { method: 'GET' });
        return json?.data?.avatars || [];
    }

    async trainPhotoAvatarGroup(groupId) {
        if (!groupId) throw new Error('groupId is required for training');
        const json = await this.requestJson('/v2/photo_avatar/train', {
            method: 'POST',
            body: { group_id: groupId }  // HeyGen API expects 'group_id', not 'avatar_group_id'
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

    normalizeDimensions(widthInput, heightInput, maxLongSide, options = {}) {
        let width = Number(widthInput);
        let height = Number(heightInput);

        const fallbackWidth = Number(options.fallbackWidth) || FALLBACK_WIDTH;
        const fallbackHeight = Number(options.fallbackHeight) || FALLBACK_HEIGHT;

        if (!Number.isFinite(width) || width <= 0) {
            width = fallbackWidth;
        }
        if (!Number.isFinite(height) || height <= 0) {
            height = fallbackHeight;
        }

        let aspectRatio = Number.isFinite(width) && Number.isFinite(height) && height !== 0
            ? width / height
            : (fallbackWidth / fallbackHeight);

        if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
            aspectRatio = fallbackWidth / fallbackHeight;
        }

        let targetWidth = width;
        let targetHeight = height;
        const longSideLimit = Number(maxLongSide);

        if (Number.isFinite(longSideLimit) && longSideLimit > 0) {
            const currentLongSide = Math.max(targetWidth, targetHeight);
            if (currentLongSide > longSideLimit) {
                if (targetWidth >= targetHeight) {
                    targetWidth = longSideLimit;
                    targetHeight = Math.round(longSideLimit / aspectRatio);
                } else {
                    targetHeight = longSideLimit;
                    targetWidth = Math.round(longSideLimit * aspectRatio);
                }
            }
        }

        targetWidth = Math.floor(targetWidth);
        targetHeight = Math.floor(targetHeight);

        if (targetWidth < 2) targetWidth = 2;
        if (targetHeight < 2) targetHeight = 2;

        // Many video encoders prefer even dimensions
        if (targetWidth % 2 !== 0) targetWidth -= 1;
        if (targetHeight % 2 !== 0) targetHeight -= 1;

        if (targetWidth < 2) targetWidth = 2;
        if (targetHeight < 2) targetHeight = 2;

        return {
            width: targetWidth,
            height: targetHeight,
            aspectRatio,
            wasAdjusted: targetWidth !== Math.floor(width) || targetHeight !== Math.floor(height)
        };
    }

    extractPlanMaxDimension(accountInfo) {
        if (!accountInfo || typeof accountInfo !== 'object') return null;

        const numericCandidates = [
            accountInfo?.data?.max_dimension,
            accountInfo?.data?.maxDimension,
            accountInfo?.data?.max_resolution,
            accountInfo?.data?.maxResolution,
            accountInfo?.data?.max_long_side,
            accountInfo?.data?.capabilities?.max_dimension,
            accountInfo?.data?.capabilities?.max_resolution,
            accountInfo?.plan?.max_dimension,
            accountInfo?.plan?.max_resolution,
            accountInfo?.subscription?.max_dimension,
            accountInfo?.subscription?.max_resolution,
            accountInfo?.data?.limits?.video?.max_dimension,
            accountInfo?.data?.limits?.video?.max_resolution
        ];

        for (const candidate of numericCandidates) {
            const value = Number(candidate);
            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }

        const planName =
            accountInfo?.data?.plan ||
            accountInfo?.data?.plan_name ||
            accountInfo?.plan?.name ||
            accountInfo?.subscription?.plan ||
            accountInfo?.data?.subscription?.plan ||
            accountInfo?.data?.account?.plan;

        if (typeof planName === 'string') {
            const normalized = planName.trim().toLowerCase();
            if (PLAN_NAME_DIMENSION_MAP[normalized]) {
                return PLAN_NAME_DIMENSION_MAP[normalized];
            }
        }

        return null;
    }

    async getPlanMaxDimension(forceRefresh = false) {
        if (!forceRefresh && Number.isFinite(this.cachedPlanMaxDimension)) {
            return this.cachedPlanMaxDimension;
        }

        const envValue = Number(process.env.HEYGEN_PLAN_MAX_DIMENSION || process.env.HEYGEN_MAX_DIMENSION);
        if (Number.isFinite(envValue) && envValue > 0) {
            this.cachedPlanMaxDimension = envValue;
            return this.cachedPlanMaxDimension;
        }

        if (this.planInfoFetchFailed && !forceRefresh) {
            this.cachedPlanMaxDimension = this.cachedPlanMaxDimension || DEFAULT_PLAN_MAX_DIMENSION;
            return this.cachedPlanMaxDimension;
        }

        try {
            const accountInfo = await this.requestJson('/v1/account/info', { method: 'GET' });
            const maxDimension = this.extractPlanMaxDimension(accountInfo);
            if (Number.isFinite(maxDimension) && maxDimension > 0) {
                this.cachedPlanMaxDimension = maxDimension;
                this.planInfoLastFetchedAt = Date.now();
                return this.cachedPlanMaxDimension;
            }
        } catch (err) {
            this.planInfoFetchFailed = true;
            console.warn('[HeygenClient] Failed to load plan info, defaulting max dimension:', err.message);
        }

        this.cachedPlanMaxDimension = DEFAULT_PLAN_MAX_DIMENSION;
        return this.cachedPlanMaxDimension;
    }

    async resolveEffectiveMaxDimension(maxDimensionOverride, planMaxDimensionOverride = null) {
        let planMax = null;
        const overridePlan = Number(planMaxDimensionOverride);
        if (Number.isFinite(overridePlan) && overridePlan > 0) {
            planMax = overridePlan;
        } else {
            planMax = await this.getPlanMaxDimension();
        }
        const overrideValue = Number(maxDimensionOverride);

        if (Number.isFinite(overrideValue) && overrideValue > 0) {
            return Math.min(planMax, overrideValue);
        }

        return planMax;
    }

    async generateVideoWithAudio(params) {
        const {
            avatarId,
            audioUrl,
            width = FALLBACK_WIDTH,
            height = FALLBACK_HEIGHT,
            avatarStyle = 'normal',
            isPhotoAvatar = false,  // Flag to use talking_photo instead of avatar
            maxDimensionOverride = null,
            planMaxDimension = null
        } = params || {};

        if (!avatarId) throw new Error('avatarId is required');
        if (!audioUrl) throw new Error('audioUrl is required');

        // Photo avatars (UGC avatars) use different character type
        const characterSettings = isPhotoAvatar ? {
            type: 'talking_photo',
            talking_photo_id: avatarId,
            talking_style: 'stable',
            scale: 1.0
        } : {
            type: 'avatar',
            avatar_id: avatarId,
            avatar_style: avatarStyle
        };

        const effectiveMaxDimension = await this.resolveEffectiveMaxDimension(
            maxDimensionOverride,
            planMaxDimension
        );
        const normalizedDimensions = this.normalizeDimensions(width, height, effectiveMaxDimension, {
            fallbackWidth: FALLBACK_WIDTH,
            fallbackHeight: FALLBACK_HEIGHT
        });

        if (normalizedDimensions.wasAdjusted) {
            console.log('[generateVideoWithAudio] Scaled dimensions to fit plan limit:', {
                requested: { width, height },
                effectiveMaxDimension,
                final: { width: normalizedDimensions.width, height: normalizedDimensions.height }
            });
        }

        const body = {
            video_inputs: [
                {
                    character: characterSettings,
                    voice: {
                        type: 'audio',
                        audio_url: audioUrl
                    }
                }
            ],
            dimension: {
                width: normalizedDimensions.width,
                height: normalizedDimensions.height
            }
        };

        console.log('[generateVideoWithAudio] Generating video with:', {
            avatarType: isPhotoAvatar ? 'talking_photo' : 'avatar',
            avatarId,
            audioUrl: audioUrl.substring(0, 50) + '...',
            width: normalizedDimensions.width,
            height: normalizedDimensions.height
        });

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
            width = FALLBACK_WIDTH,
            height = FALLBACK_HEIGHT,
            avatarStyle = 'normal',
            title,
            callbackId,
            folderId,
            maxDimensionOverride = null,
            planMaxDimension = null
        } = params || {};

        if (!avatarId) throw new Error('avatarId is required');
        if (!audioAssetId) throw new Error('audioAssetId is required');

        const effectiveMaxDimension = await this.resolveEffectiveMaxDimension(
            maxDimensionOverride,
            planMaxDimension
        );
        const normalizedDimensions = this.normalizeDimensions(width, height, effectiveMaxDimension, {
            fallbackWidth: FALLBACK_WIDTH,
            fallbackHeight: FALLBACK_HEIGHT
        });

        if (normalizedDimensions.wasAdjusted) {
            console.log('[generateVideoWithAudioAsset] Scaled dimensions to fit plan limit:', {
                requested: { width, height },
                effectiveMaxDimension,
                final: { width: normalizedDimensions.width, height: normalizedDimensions.height }
            });
        }

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
                width: normalizedDimensions.width,
                height: normalizedDimensions.height
            }
        };

        const json = await this.requestJson('/v2/video/generate', { method: 'POST', body });
        const videoId = json?.data?.video_id || json?.data?.id || json?.data?.videoId;
        if (!videoId) throw new Error('Failed to retrieve video_id from HeyGen');
        return videoId;
    }
}

const heygenClient = new HeygenClient();

/**
 * Helper function to parse event body
 */
function parseEventBody(event) {
    if (typeof event.body === 'string') {
        let bodyString = event.body;
        if (event.isBase64Encoded) {
            bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
        }
        return JSON.parse(bodyString || '{}');
    }
    return event.body || {};
}

/**
 * Helper function to verify Firebase token and get userId
 */
async function verifyTokenAndGetUserId(event) {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Unauthorized - No token provided');
    }
    const idToken = authHeader.split('Bearer ')[1];
    await firebaseInitializer.initialize();
    const admin = require('firebase-admin');
    const decoded = await admin.auth().verifyIdToken(idToken);
    return { userId: decoded.uid, admin };
}

/**
 * Get a file URL from Firebase Storage URL using admin credentials
 * Extracts the storage path and generates a signed URL for server-side access
 */
async function getFileUrlFromStorageUrl(storageUrl, admin) {
    try {
        // Parse the Firebase Storage URL to get the file path
        // Format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token={token}
        // Or: https://storage.googleapis.com/{bucket}/{path}
        let filePath = null;
        
        if (storageUrl.includes('firebasestorage.googleapis.com')) {
            // Extract path from Firebase Storage URL
            const urlMatch = storageUrl.match(/\/o\/([^?]+)/);
            if (urlMatch) {
                filePath = decodeURIComponent(urlMatch[1]);
            }
        } else if (storageUrl.includes('storage.googleapis.com')) {
            // Extract path from GCS URL
            const urlMatch = storageUrl.match(/storage\.googleapis\.com\/[^\/]+\/(.+)$/);
            if (urlMatch) {
                filePath = urlMatch[1];
            }
        }
        
        if (!filePath) {
            console.warn('[getFileUrlFromStorageUrl] Could not parse storage path from URL, using original URL:', storageUrl);
            return storageUrl;
        }
        
        console.log('[getFileUrlFromStorageUrl] Extracted file path:', filePath);
        
        // Get the file using Firebase Admin Storage
        const bucket = admin.storage().bucket();
        const file = bucket.file(filePath);
        
        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
            console.warn('[getFileUrlFromStorageUrl] File does not exist in storage, using original URL:', storageUrl);
            return storageUrl;
        }
        
        // Generate a signed URL that's valid for 1 hour (server-side access)
        const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 3600000 // 1 hour
        });
        
        console.log('[getFileUrlFromStorageUrl] Generated signed URL for server-side access');
        return signedUrl;
    } catch (err) {
        console.error('[getFileUrlFromStorageUrl] Error generating signed URL:', err);
        // Fallback to original URL if we can't generate signed URL
        console.warn('[getFileUrlFromStorageUrl] Falling back to original URL:', storageUrl);
        return storageUrl;
    }
}

/**
 * Initialize HeyGen avatar group
 */
async function handleHeygenAvatarGroupInit(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { groupDocId, displayName } = body;

        if (!groupDocId || !displayName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'groupDocId and displayName are required' })
            };
        }

        const db = admin.firestore();
        const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupDocId);
        const groupDoc = await groupRef.get();

        if (!groupDoc.exists) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Avatar group not found' })
            };
        }

        const groupData = groupDoc.data();
        
        // If group already has avatar_group_id, return it
        if (groupData.avatar_group_id) {
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    success: true,
                    avatar_group_id: groupData.avatar_group_id,
                    message: 'Avatar group already initialized'
                })
            };
        }

        // Create HeyGen photo avatar group
        // NOTE: HeyGen API requires image_key - cannot create empty group
        // For init endpoint, we'll need to wait until first asset is uploaded
        // Cannot create group without an image - return error
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: 'Cannot initialize avatar group without assets',
                message: 'HeyGen requires at least one image to create an avatar group. Please upload an asset first, then the group will be created automatically.'
            })
        };
    } catch (err) {
        console.error('HeyGen avatar group init error:', err);
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to initialize HeyGen avatar group',
                message: err.message
            })
        };
    }
}

/**
 * Add look to HeyGen avatar group
 */
async function handleHeygenAvatarGroupAddLook(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { groupDocId, assetId, imageUrl } = body; // Support both assetId (preferred) and imageUrl (legacy)

        if (!groupDocId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'groupDocId is required' })
            };
        }

        if (!assetId && !imageUrl) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'assetId or imageUrl is required' })
            };
        }

        const db = admin.firestore();
        
        // Get the image URL from Firestore if assetId is provided
        let imageUrlToUse = imageUrl;
        let assetName = assetId || `asset_${Date.now()}`; // Use assetId as name
        
        if (assetId && !imageUrl) {
            const assetsRef = db.collection('users').doc(userId)
                .collection('heygenAvatarGroups').doc(groupDocId)
                .collection('assets');
            const assetDoc = await assetsRef.doc(assetId).get();
            
            if (!assetDoc.exists) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Asset not found' })
                };
            }
            
            const assetData = assetDoc.data();
            imageUrlToUse = assetData.url;
            
            if (!imageUrlToUse) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Asset document missing url field' })
                };
            }
            
            console.log('[handleHeygenAvatarGroupAddLook] Retrieved imageUrl from Firestore asset:', imageUrlToUse);
        }

        const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupDocId);
        const groupDoc = await groupRef.get();

        if (!groupDoc.exists) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Avatar group not found' })
            };
        }

        const groupData = groupDoc.data();
        let avatarGroupId = groupData.avatar_group_id;

        console.log('[handleHeygenAvatarGroupAddLook] Group data from Firestore:', {
            groupDocId,
            hasAvatarGroupId: !!avatarGroupId,
            avatarGroupId,
            displayName: groupData.displayName
        });

        // If group doesn't have avatar_group_id yet, create it with the current image
        if (!avatarGroupId) {
            console.log('[handleHeygenAvatarGroupAddLook] Creating new HeyGen avatar group with image:', imageUrlToUse);
            const groupName = groupData.displayName || `masky_${userId}`;
            // Create group with the image being added (HeyGen API requires image_key)
            // Use server-side Firebase Admin to get the file directly
            const fileUrl = await getFileUrlFromStorageUrl(imageUrlToUse, admin);
            avatarGroupId = await heygenClient.createPhotoAvatarGroup(groupName, fileUrl);
            console.log('[handleHeygenAvatarGroupAddLook] Created HeyGen avatar group:', avatarGroupId);
            await groupRef.update({
                avatar_group_id: avatarGroupId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            // Image is already added during group creation, so we're done
            console.log('[handleHeygenAvatarGroupAddLook] Image already added during group creation');
        } else {
            // Verify the avatar group exists in HeyGen
            console.log('[handleHeygenAvatarGroupAddLook] Verifying avatar group exists in HeyGen:', avatarGroupId);
            try {
                const heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
                console.log('[handleHeygenAvatarGroupAddLook] Avatar group verified, current looks count:', heygenLooks?.length || 0);
            } catch (verifyErr) {
                console.warn('[handleHeygenAvatarGroupAddLook] Could not verify avatar group (may not exist in HeyGen):', verifyErr.message);
                // If group doesn't exist, create a new one with the current image
                console.log('[handleHeygenAvatarGroupAddLook] Creating new HeyGen avatar group to replace missing one...');
                const groupName = groupData.displayName || `masky_${userId}`;
                // Create replacement group with the image being added
                // Use server-side Firebase Admin to get the file directly
                const fileUrl = await getFileUrlFromStorageUrl(imageUrlToUse, admin);
                avatarGroupId = await heygenClient.createPhotoAvatarGroup(groupName, fileUrl);
                await groupRef.update({
                    avatar_group_id: avatarGroupId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log('[handleHeygenAvatarGroupAddLook] Created replacement HeyGen avatar group:', avatarGroupId);
                // Image is already added during group creation, so we're done
                console.log('[handleHeygenAvatarGroupAddLook] Image already added during replacement group creation');
            }
        }

        // Add look to the HeyGen avatar group (only if group already existed)
        // If we just created the group, the image was already added during creation
        let photoAvatarId = null;
        if (avatarGroupId && groupData.avatar_group_id) {
            console.log('[handleHeygenAvatarGroupAddLook] About to add look to existing HeyGen group:', {
                avatarGroupId,
                imageUrl: imageUrlToUse,
                groupDocId
            });
            try {
                // Use server-side Firebase Admin to get the file directly
                const fileUrl = await getFileUrlFromStorageUrl(imageUrlToUse, admin);
                const addLookResponse = await heygenClient.addLooksToPhotoAvatarGroup(avatarGroupId, [{ url: fileUrl, name: assetName, assetId: assetName }], assetName);
                console.log('[handleHeygenAvatarGroupAddLook] Successfully added look to HeyGen');
                
                // Extract photo avatar ID from response
                if (addLookResponse && addLookResponse.photo_avatar_list && addLookResponse.photo_avatar_list.length > 0) {
                    const photoAvatar = addLookResponse.photo_avatar_list[0];
                    photoAvatarId = photoAvatar.id;
                    console.log('[handleHeygenAvatarGroupAddLook] Got HeyGen photo avatar ID:', photoAvatarId);
                    
                    // Save the HeyGen photo avatar ID to the Firestore asset document
                    if (assetId && photoAvatarId) {
                        const assetsRef = db.collection('users').doc(userId)
                            .collection('heygenAvatarGroups').doc(groupDocId)
                            .collection('assets');
                        await assetsRef.doc(assetId).update({
                            heygenPhotoAvatarId: photoAvatarId,
                            heygenStatus: photoAvatar.status || 'pending',
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('[handleHeygenAvatarGroupAddLook] Saved HeyGen photo avatar ID to Firestore asset:', assetId);
                    }
                }
            } catch (addErr) {
                console.error('[handleHeygenAvatarGroupAddLook] Failed to add look:', addErr);
                console.error('[handleHeygenAvatarGroupAddLook] Error details:', addErr.details || addErr.message);
                throw addErr;
            }
        }

        // Start training if not already trained (check training status first)
        let trainingStatus = null;
        let trainingStarted = false;
        try {
            trainingStatus = await heygenClient.getTrainingJobStatus(avatarGroupId);
            
            // If training is not completed, we might want to start it
            if (!trainingStatus || trainingStatus.status !== 'completed') {
                // Try to start training (idempotent - if already training, this will just return)
                try {
                    await heygenClient.trainPhotoAvatarGroup(avatarGroupId);
                    trainingStarted = true;
                    console.log('Training started for avatar group:', avatarGroupId);
                } catch (trainErr) {
                    // Training might already be in progress
                    console.log('Training may already be in progress:', trainErr.message);
                }
            }
        } catch (statusErr) {
            // If we can't get status, try to start training anyway
            console.log('Could not get training status, attempting to start training:', statusErr.message);
            try {
                await heygenClient.trainPhotoAvatarGroup(avatarGroupId);
                trainingStarted = true;
            } catch (trainErr) {
                console.warn('Could not start training:', trainErr.message);
            }
        }

        // Return 202 if training is in progress, 200 if completed
        const statusCode = (trainingStatus && trainingStatus.status === 'completed') ? 200 : 202;
        
        return {
            statusCode: statusCode,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                avatar_group_id: avatarGroupId,
                photo_avatar_id: photoAvatarId,
                trainingStatus: trainingStatus?.status || 'pending',
                trainingStarted: trainingStarted,
                message: statusCode === 202 
                    ? 'Look added and training in progress' 
                    : 'Look added successfully'
            })
        };
    } catch (err) {
        console.error('[handleHeygenAvatarGroupAddLook] Error:', err);
        // Extract actual error message from details if available
        let errorMessage = err.message;
        if (err.details) {
            if (err.details.error && err.details.error.message) {
                errorMessage = err.details.error.message;
            } else if (typeof err.details === 'object') {
                errorMessage = JSON.stringify(err.details);
            }
        }
        // If message is still [object Object], try to stringify the whole error
        if (errorMessage === '[object Object]' || !errorMessage) {
            try {
                errorMessage = JSON.stringify(err.details || err);
            } catch {
                errorMessage = String(err);
            }
        }
        
        // Include exact API call details in error response
        const errorResponse = {
            error: 'Failed to add look to HeyGen avatar group',
            message: errorMessage,
            details: err.details || null
        };
        
        if (err.apiCall) {
            errorResponse.apiCall = err.apiCall;
        } else {
            // Construct API call info from context
            errorResponse.apiCall = {
                method: 'POST',
                url: 'https://api.heygen.com/v2/photo_avatar/avatar_group/add',
                endpoint: '/v2/photo_avatar/avatar_group/add',
                note: 'Exact request body not available in error context'
            };
        }
        
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify(errorResponse, null, 2)
        };
    }
}

/**
 * Remove look from HeyGen avatar group
 */
async function handleHeygenAvatarGroupRemoveLook(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { groupDocId, imageUrl, assetId } = body;

        if (!groupDocId || !imageUrl) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'groupDocId and imageUrl are required' })
            };
        }

        const db = admin.firestore();
        const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupDocId);
        const groupDoc = await groupRef.get();

        if (!groupDoc.exists) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Avatar group not found' })
            };
        }

        const groupData = groupDoc.data();
        const avatarGroupId = groupData.avatar_group_id;

        // ALWAYS remove asset from Firestore first, regardless of HeyGen success or avatar_group_id
        let firestoreDeleted = false;
        if (assetId) {
            const assetRef = db.collection('users').doc(userId)
                .collection('heygenAvatarGroups').doc(groupDocId)
                .collection('assets').doc(assetId);
            const assetDoc = await assetRef.get();
            
            if (assetDoc.exists) {
                await assetRef.delete();
                firestoreDeleted = true;
                console.log('Deleted asset from Firestore:', assetId);
            }
        }

        // Try to remove look from HeyGen avatar group (non-blocking, only if group exists)
        let heygenDeleted = false;
        if (avatarGroupId) {
            try {
                await heygenClient.removeLookFromPhotoAvatarGroup(avatarGroupId, imageUrl);
                heygenDeleted = true;
                console.log('Deleted look from HeyGen avatar group');
            } catch (heygenErr) {
                // If HeyGen API doesn't support remove or returns an error, log but continue
                console.warn('HeyGen remove look failed (asset already removed from Firestore):', heygenErr.message);
            }

            // Sync assets: Remove from HeyGen any assets not in our Firestore
            try {
                console.log('Syncing assets between Firestore and HeyGen...');
                const assetsRef = db.collection('users').doc(userId)
                    .collection('heygenAvatarGroups').doc(groupDocId)
                    .collection('assets');
                const assetsSnapshot = await assetsRef.get();
                const ourAssetUrls = new Set(assetsSnapshot.docs.map(doc => doc.data().url).filter(Boolean));
                
                console.log('Our Firestore asset URLs:', Array.from(ourAssetUrls));
                
                // List looks from HeyGen (if API supports it)
                const heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
                console.log('HeyGen looks:', JSON.stringify(heygenLooks, null, 2));
                
                // If we can get HeyGen looks, remove any that aren't in our system
                if (Array.isArray(heygenLooks) && heygenLooks.length > 0) {
                    for (const look of heygenLooks) {
                        const lookUrl = look.url || look.image_url;
                        if (lookUrl && !ourAssetUrls.has(lookUrl)) {
                            console.log('Removing orphaned look from HeyGen:', lookUrl);
                            try {
                                await heygenClient.removeLookFromPhotoAvatarGroup(avatarGroupId, lookUrl);
                            } catch (err) {
                                console.warn('Failed to remove orphaned look from HeyGen:', err.message);
                            }
                        }
                    }
                }
            } catch (syncErr) {
                console.warn('Asset sync failed (non-critical):', syncErr.message);
            }
        } else {
            console.log('No avatar_group_id found - skipping HeyGen operations (asset already removed from Firestore)');
        }

        // Return success if Firestore deletion succeeded, regardless of HeyGen
        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                firestoreDeleted,
                heygenDeleted,
                message: 'Asset removed successfully'
            })
        };
    } catch (err) {
        console.error('HeyGen avatar group remove-look error:', err);
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to remove look from HeyGen avatar group',
                message: err.message
            })
        };
    }
}

/**
 * Sync assets between Firestore and HeyGen for an avatar group
 */
async function handleHeygenAvatarGroupSync(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { groupDocId } = body;

        if (!groupDocId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'groupDocId is required' })
            };
        }

        const db = admin.firestore();
        const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupDocId);
        const groupDoc = await groupRef.get();

        if (!groupDoc.exists) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Avatar group not found' })
            };
        }

        const groupData = groupDoc.data();
        let avatarGroupId = groupData.avatar_group_id;

        // Get our Firestore assets first (before creating HeyGen group)
        const assetsRef = db.collection('users').doc(userId)
            .collection('heygenAvatarGroups').doc(groupDocId)
            .collection('assets');
        const assetsSnapshot = await assetsRef.get();
        const ourAssets = new Map();
        assetsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.url) {
                ourAssets.set(data.url, { id: doc.id, ...data });
            }
        });

        // If group doesn't have avatar_group_id yet, create it with the first asset
        // NOTE: HeyGen API requires image_key when creating a group - cannot create empty group
        let groupWasCreated = false;
        if (!avatarGroupId) {
            if (ourAssets.size === 0) {
                console.log('[sync] No assets found - cannot create HeyGen avatar group (requires at least one image)');
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Cannot create avatar group without assets',
                        message: 'HeyGen requires at least one image to create an avatar group. Please upload an asset first.'
                    })
                };
            }
            
            console.log('[sync] Creating new HeyGen avatar group with first asset...');
            const groupName = groupData.displayName || `masky_${userId}`;
            const assetUrls = Array.from(ourAssets.keys());
            const firstAssetUrl = assetUrls[0];
            const remainingAssetUrls = assetUrls.slice(1);
            
            try {
                // Create group with first asset (HeyGen API requires image_key)
                avatarGroupId = await heygenClient.createPhotoAvatarGroup(groupName, firstAssetUrl);
                console.log('[sync] Created HeyGen avatar group:', avatarGroupId);
                await groupRef.update({
                    avatar_group_id: avatarGroupId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                groupWasCreated = true;
                
                // Add remaining assets to the group
                if (remainingAssetUrls.length > 0) {
                    console.log('[sync] Adding remaining Firestore assets to new HeyGen group:', remainingAssetUrls.length);
                    console.log('[sync] Remaining asset URLs:', remainingAssetUrls);
                        try {
                            // Convert all remaining URLs to server-side accessible URLs
                            const remainingFileUrls = await Promise.all(
                                remainingAssetUrls.map(url => getFileUrlFromStorageUrl(url, admin))
                            );
                            await heygenClient.addLooksToPhotoAvatarGroup(avatarGroupId, remainingFileUrls.map((url, i) => ({ url, name: `sync_asset_${i}` })), 'sync_batch');
                            console.log('[sync] Successfully added', remainingAssetUrls.length, 'remaining assets to HeyGen group');
                    } catch (addErr) {
                        console.error('[sync] Failed to add remaining assets to HeyGen group:', addErr.message);
                        console.error('[sync] Error details:', addErr.details || addErr);
                        // Don't throw - group was created successfully with first asset
                        // Remaining assets can be added later
                    }
                }
            } catch (createErr) {
                console.error('[sync] Failed to create HeyGen avatar group:', createErr.message);
                console.error('[sync] Error details:', createErr.details || createErr);
                throw new Error(`Failed to create HeyGen avatar group: ${createErr.message}`);
            }
        } else {
            // Verify the avatar group exists in HeyGen
            console.log('[sync] Verifying avatar group exists in HeyGen:', avatarGroupId);
            try {
                const heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
                console.log('[sync] Avatar group verified, current looks count:', heygenLooks?.length || 0);
            } catch (verifyErr) {
                console.warn('[sync] Could not verify avatar group (may not exist in HeyGen):', verifyErr.message);
                // If group doesn't exist, create a new one with first asset
                if (ourAssets.size === 0) {
                    console.log('[sync] No assets found - cannot create replacement HeyGen avatar group');
                    // Continue with sync - we'll just have an empty group in Firestore
                } else {
                    console.log('[sync] Creating new HeyGen avatar group to replace missing one...');
                    const groupName = groupData.displayName || `masky_${userId}`;
                    const assetUrls = Array.from(ourAssets.keys());
                    const firstAssetUrl = assetUrls[0];
                    const remainingAssetUrls = assetUrls.slice(1);
                    
                    try {
                        // Create replacement group with first asset
                        // Use server-side Firebase Admin to get the file directly
                        const fileUrl = await getFileUrlFromStorageUrl(firstAssetUrl, admin);
                        avatarGroupId = await heygenClient.createPhotoAvatarGroup(groupName, fileUrl);
                        await groupRef.update({
                            avatar_group_id: avatarGroupId,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        console.log('[sync] Created replacement HeyGen avatar group:', avatarGroupId);
                        groupWasCreated = true;
                        
                        // Add remaining assets to the replacement group
                        if (remainingAssetUrls.length > 0) {
                            console.log('[sync] Adding remaining assets to replacement HeyGen group:', remainingAssetUrls.length);
                            try {
                                // Convert all remaining URLs to server-side accessible URLs
                                const remainingFileUrls = await Promise.all(
                                    remainingAssetUrls.map(url => getFileUrlFromStorageUrl(url, admin))
                                );
                                await heygenClient.addLooksToPhotoAvatarGroup(avatarGroupId, remainingFileUrls.map((url, i) => ({ url, name: `sync_replacement_${i}` })), 'sync_replacement_batch');
                                console.log('[sync] Successfully added', remainingAssetUrls.length, 'remaining assets to replacement HeyGen group');
                            } catch (addErr) {
                                console.error('[sync] Failed to add remaining assets to replacement HeyGen group:', addErr.message);
                                // Don't throw - group was created successfully
                            }
                        }
                    } catch (createErr) {
                        console.error('[sync] Failed to create replacement HeyGen avatar group:', createErr.message);
                        console.error('[sync] Error details:', createErr.details || createErr);
                        throw new Error(`Failed to create replacement HeyGen avatar group: ${createErr.message}`);
                    }
                }
            }
        }

        // Re-fetch HeyGen looks after potentially creating/adding assets
        console.log('[sync] Our Firestore assets:', Array.from(ourAssets.keys()));

        // Get HeyGen looks
        const heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
        console.log('[sync] HeyGen looks (raw):', JSON.stringify(heygenLooks, null, 2));
        console.log('[sync] HeyGen looks type:', typeof heygenLooks, 'isArray:', Array.isArray(heygenLooks));
        
        // Also get the raw API response for debugging (using correct endpoint)
        let rawHeyGenResponse = null;
        try {
            const path = `/v2/avatar_group/${encodeURIComponent(avatarGroupId)}/avatars`;
            const apiKey = await heygenClient.initialize();
            const https = require('https');
            rawHeyGenResponse = await new Promise((resolve, reject) => {
                const req = https.request(`https://api.heygen.com${path}`, {
                    method: 'GET',
                    headers: {
                        'X-Api-Key': apiKey,
                        'Accept': 'application/json'
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(body || '{}'));
                        } catch (e) {
                            resolve({ rawBody: body, parseError: e.message });
                        }
                    });
                });
                req.on('error', reject);
                req.end();
            });
            console.log('[sync] Raw HeyGen API response:', JSON.stringify(rawHeyGenResponse, null, 2));
        } catch (rawErr) {
            console.error('[sync] Failed to get raw HeyGen response:', rawErr.message);
        }

        const heygenUrls = new Set();
        const heygenLookMap = new Map(); // Map URL to full look object
        if (Array.isArray(heygenLooks)) {
            heygenLooks.forEach(look => {
                // Try multiple possible URL fields
                const url = look.url || 
                           look.image_url || 
                           look.imageUrl ||
                           look.image ||
                           (look.image_key ? `heygen://image_key/${look.image_key}` : null);
                
                if (url) {
                    heygenUrls.add(url);
                    heygenLookMap.set(url, look);
                    console.log('[sync] Found HeyGen look with URL:', url);
                } else {
                    console.warn('[sync] HeyGen look missing URL field:', JSON.stringify(look, null, 2));
                }
            });
        } else if (heygenLooks && typeof heygenLooks === 'object') {
            // Handle single look object (not in array)
            const url = heygenLooks.url || 
                       heygenLooks.image_url || 
                       heygenLooks.imageUrl ||
                       heygenLooks.image ||
                       (heygenLooks.image_key ? `heygen://image_key/${heygenLooks.image_key}` : null);
            if (url) {
                heygenUrls.add(url);
                heygenLookMap.set(url, heygenLooks);
                console.log('[sync] Found single HeyGen look with URL:', url);
            }
        }
        
        console.log('[sync] Total HeyGen URLs found:', heygenUrls.size);

        // Add to Firestore any HeyGen looks that aren't in our Firestore
        const addedToFirestore = [];
        for (const url of heygenUrls) {
            if (!ourAssets.has(url)) {
                console.log('[sync] Adding HeyGen look to Firestore (exists in HeyGen but not Firestore):', url);
                try {
                    const look = heygenLookMap.get(url);
                    // Extract filename from URL or use a default
                    const urlParts = url.split('/');
                    const fileName = urlParts[urlParts.length - 1].split('?')[0] || 'asset.jpg';
                    
                    await assetsRef.add({
                        url: url,
                        fileName: fileName,
                        userId: userId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        syncedFromHeyGen: true // Flag to indicate this was synced from HeyGen
                    });
                    addedToFirestore.push(url);
                    console.log('[sync] Successfully added HeyGen look to Firestore:', url);
                } catch (err) {
                    console.error('[sync] Failed to add HeyGen look to Firestore:', err.message);
                }
            }
        }

        // Remove from Firestore any assets not in HeyGen (only if they weren't just added)
        const removedFromFirestore = [];
        for (const [url, asset] of ourAssets.entries()) {
            if (!heygenUrls.has(url)) {
                console.log('[sync] Removing asset from Firestore (not in HeyGen):', url);
                await assetsRef.doc(asset.id).delete();
                removedFromFirestore.push(asset.id);
            }
        }

        // Note: We no longer remove from HeyGen automatically - if it exists in HeyGen, we keep it
        // This prevents accidental deletion of assets that exist in HeyGen but were temporarily missing from Firestore
        const removedFromHeyGen = [];
        // Only remove from HeyGen if explicitly requested (for now, we keep everything in HeyGen)

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                firestoreAssetsCount: ourAssets.size,
                heygenLooksCount: heygenUrls.size,
                heygenLooksRaw: heygenLooks, // Full raw response from listLooksInPhotoAvatarGroup
                heygenApiResponse: rawHeyGenResponse, // Full raw API response for debugging
                heygenUrls: Array.from(heygenUrls), // All URLs found in HeyGen
                addedToFirestore: addedToFirestore.length,
                addedToFirestoreUrls: addedToFirestore,
                removedFromFirestore: removedFromFirestore.length,
                removedFromFirestoreIds: removedFromFirestore,
                removedFromHeyGen: removedFromHeyGen.length,
                message: 'Sync completed'
            })
        };
    } catch (err) {
        console.error('[sync] Error:', err);
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to sync avatar group',
                message: err.message
            })
        };
    }
}

/**
 * Delete avatar group and all its assets from Firestore and HeyGen
 */
async function handleHeygenAvatarGroupDelete(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { groupDocId } = body;

        if (!groupDocId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'groupDocId is required' })
            };
        }

        const db = admin.firestore();
        const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupDocId);
        const groupDoc = await groupRef.get();

        if (!groupDoc.exists) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Avatar group not found' })
            };
        }

        const groupData = groupDoc.data();
        const avatarGroupId = groupData.avatar_group_id;

        // Delete all assets from Firestore
        const assetsRef = db.collection('users').doc(userId)
            .collection('heygenAvatarGroups').doc(groupDocId)
            .collection('assets');
        const assetsSnapshot = await assetsRef.get();
        const deletedAssets = [];
        
        for (const assetDoc of assetsSnapshot.docs) {
            await assetDoc.ref.delete();
            deletedAssets.push(assetDoc.id);
        }
        console.log('[delete] Deleted', deletedAssets.length, 'assets from Firestore');

        // Delete avatar group from HeyGen if it exists
        let heygenDeleted = false;
        if (avatarGroupId) {
            try {
                // Note: HeyGen API may not have a direct delete endpoint for avatar groups
                // We'll try to remove all looks first, then the group if possible
                const heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
                if (Array.isArray(heygenLooks) && heygenLooks.length > 0) {
                    console.log('[delete] Removing', heygenLooks.length, 'looks from HeyGen group');
                    for (const look of heygenLooks) {
                        const lookUrl = look.url || look.image_url;
                        if (lookUrl) {
                            try {
                                await heygenClient.removeLookFromPhotoAvatarGroup(avatarGroupId, lookUrl);
                            } catch (err) {
                                console.warn('[delete] Failed to remove look from HeyGen:', err.message);
                            }
                        }
                    }
                }
                
                // Try to delete the group itself (if API supports it)
                // For now, we'll just remove all looks - the group may remain but will be empty
                heygenDeleted = true;
                console.log('[delete] Removed all looks from HeyGen avatar group');
            } catch (heygenErr) {
                console.warn('[delete] Failed to delete from HeyGen (non-critical):', heygenErr.message);
                // Continue with Firestore deletion even if HeyGen deletion fails
            }
        }

        // Delete the group document from Firestore
        await groupRef.delete();
        console.log('[delete] Deleted avatar group from Firestore');

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                deletedAssetsCount: deletedAssets.length,
                heygenDeleted,
                message: 'Avatar group deleted successfully'
            })
        };
    } catch (err) {
        console.error('[delete] Error:', err);
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to delete avatar group',
                message: err.message
            })
        };
    }
}

/**
 * Claim an existing HeyGen avatar group by ID
 * Creates a Firestore document and syncs assets from HeyGen
 */
async function handleHeygenAvatarGroupClaim(event, headers) {
    try {
        const { userId, admin } = await verifyTokenAndGetUserId(event);
        const body = parseEventBody(event);
        const { heygenGroupId, displayName } = body;

        if (!heygenGroupId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'heygenGroupId is required' })
            };
        }

        const db = admin.firestore();
        
        // Verify the HeyGen group exists and get its details
        console.log('[claim] Verifying HeyGen avatar group exists:', heygenGroupId);
        let heygenLooks = [];
        try {
            heygenLooks = await heygenClient.listLooksInPhotoAvatarGroup(heygenGroupId);
            console.log('[claim] HeyGen group verified, found', heygenLooks.length, 'look(s)');
        } catch (verifyErr) {
            console.error('[claim] Failed to verify HeyGen group:', verifyErr.message);
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({
                    error: 'HeyGen avatar group not found',
                    message: `Could not find avatar group with ID: ${heygenGroupId}`
                })
            };
        }

        // Create new Firestore document for this group
        const groupsRef = db.collection('users').doc(userId).collection('heygenAvatarGroups');
        const groupDocRef = await groupsRef.add({
            userId: userId,
            displayName: displayName || `HeyGen Avatar ${Date.now()}`,
            avatar_group_id: heygenGroupId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            claimedFromHeyGen: true
        });
        const groupDocId = groupDocRef.id;
        console.log('[claim] Created Firestore group document:', groupDocId);

        // Sync assets from HeyGen to Firestore
        const assetsRef = groupsRef.doc(groupDocId).collection('assets');
        const addedAssets = [];
        
        for (const look of heygenLooks) {
            const url = look.url || 
                       look.image_url || 
                       look.imageUrl ||
                       look.image ||
                       (look.image_key ? `heygen://image_key/${look.image_key}` : null);
            
            if (url) {
                try {
                    const urlParts = url.split('/');
                    const fileName = urlParts[urlParts.length - 1].split('?')[0] || 'asset.jpg';
                    
                    await assetsRef.add({
                        url: url,
                        fileName: fileName,
                        userId: userId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        syncedFromHeyGen: true,
                        claimedFromHeyGen: true
                    });
                    addedAssets.push(url);
                    console.log('[claim] Added asset to Firestore:', url);
                } catch (err) {
                    console.error('[claim] Failed to add asset to Firestore:', err.message);
                }
            }
        }

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                groupDocId: groupDocId,
                avatar_group_id: heygenGroupId,
                displayName: displayName || `HeyGen Avatar ${Date.now()}`,
                assetsAdded: addedAssets.length,
                message: 'Avatar group claimed successfully'
            })
        };
    } catch (err) {
        console.error('[claim] Error:', err);
        return {
            statusCode: err.message.includes('Unauthorized') ? 401 : 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to claim HeyGen avatar group',
                message: err.message
            })
        };
    }
}

module.exports = Object.assign(heygenClient, {
    handleHeygenAvatarGroupInit,
    handleHeygenAvatarGroupAddLook,
    handleHeygenAvatarGroupRemoveLook,
    handleHeygenAvatarGroupSync,
    handleHeygenAvatarGroupDelete,
    handleHeygenAvatarGroupClaim
});


