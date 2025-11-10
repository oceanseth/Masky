// Load local environment FIRST before any other imports
if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
    console.log('🔧 Loading local environment for Lambda handler...');
    console.log('   IS_OFFLINE:', process.env.IS_OFFLINE);
    console.log('   STAGE:', process.env.STAGE);
    
    try {
        const { loadLocalEnv } = require('../local-env-loader');
        loadLocalEnv();
        console.log('   ✓ Local environment loaded');
        
        // Verify environment variables were loaded
        console.log('   FIREBASE_SERVICE_ACCOUNT:', !!process.env.FIREBASE_SERVICE_ACCOUNT ? 'exists' : 'MISSING');
        console.log('   TWITCH_CLIENT_ID:', process.env.TWITCH_CLIENT_ID || 'MISSING');
        console.log('   HEYGEN_API_KEY:', !!process.env.HEYGEN_API_KEY ? 'exists' : 'MISSING');
    } catch (error) {
        console.error('❌ Failed to load local environment:', error.message);
        console.error('   Stack:', error.stack);
    }
}

const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    region: 'us-east-1',
    signatureVersion: 'v4',
    endpoint: 'https://s3.us-east-1.amazonaws.com'  // Specify regional endpoint
});
const firebaseInitializer = require('../utils/firebaseInit');
const stripeInitializer = require('../utils/stripeInit');
const twitchInitializer = require('../utils/twitchInit');
const heygen = require('../utils/heygen');
const {
    handleHeygenAvatarGroupInit,
    handleHeygenAvatarGroupAddLook,
    handleHeygenAvatarGroupRemoveLook,
    handleHeygenAvatarGroupSync,
    handleHeygenAvatarGroupDelete,
    handleHeygenAvatarGroupClaim
} = require('../utils/heygen');
const { parseMultipartData } = require('./multipartParser');

// Handle Twitch OAuth login (legacy - for direct access token)
const handleTwitchOAuth = async (event) => {
    try {
        // Parse body - it might be base64 encoded, a string, or an object
        let body;
        if (typeof event.body === 'string') {
            // Check if body is base64 encoded (API Gateway does this)
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }
        console.log('Parsed body:', JSON.stringify(body));
        const { accessToken } = body;

        if (!accessToken) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing accessToken in request body' })
            };
        }

        // Verify Twitch token and get user info using twitchInitializer
        const twitchUser = await twitchInitializer.verifyToken(accessToken);
        const uid = `twitch:${twitchUser.id}`;

        // Initialize Firebase Admin
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');

        // Create or update user in Firebase
        let userRecord;
        try {
            userRecord = await admin.auth().getUser(uid);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create new user
                userRecord = await admin.auth().createUser({
                    uid: uid,
                    displayName: twitchUser.display_name,
                    photoURL: twitchUser.profile_image_url,
                    email: twitchUser.email
                });
            } else {
                throw error;
            }
        }

        // Create custom token for Firebase authentication
        const customToken = await admin.auth().createCustomToken(uid, {
            provider: 'twitch',
            twitchId: twitchUser.id,
            displayName: twitchUser.display_name,
            profileImage: twitchUser.profile_image_url
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                firebaseToken: customToken,
                user: {
                    uid: uid,
                    displayName: twitchUser.display_name,
                    photoURL: twitchUser.profile_image_url,
                    email: twitchUser.email,
                    twitchId: twitchUser.id
                }
            })
        };

    } catch (error) {
        console.error('Twitch OAuth error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};

exports.handler = async (event, context) => {
    console.log('Event received:', JSON.stringify({ 
        path: event.path, 
        httpMethod: event.httpMethod,
        body: event.body,
        headers: event.headers 
    }));
    
    // CORS: Allow requests from any origin (including localhost)
    const requestOrigin = event.headers?.origin || event.headers?.Origin || '*';
    const headers = {
        'Access-Control-Allow-Origin': requestOrigin === '*' ? '*' : requestOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': requestOrigin !== '*' ? 'true' : 'false',
        'Access-Control-Max-Age': '86400'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Route handling
    let path = event.path || event.rawPath || '';
    // Normalize path: ensure it starts with / and remove /api prefix if present
    // API Gateway proxy integration may include or exclude /api prefix
    if (path && !path.startsWith('/')) {
        path = '/' + path;
    }
    // Remove /api prefix if present for consistent matching
    if (path.startsWith('/api/')) {
        path = path.substring(4); // Remove '/api'
    }
    const method = event.httpMethod || event.requestContext?.http?.method;

    // Handle Twitch OAuth callback (authorization code exchange)
    if (path.includes('/twitch_oauth_callback') && method === 'POST') {
        const response = await twitchInitializer.handleOAuthCallback(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Heygen proxy: video_status.get
    if (path.includes('/heygen/video_status.get') && method === 'GET') {
        try {
            const url = new URL(event.rawUrl || `${event.headers.origin || 'https://masky.ai'}${path}${event.rawQueryString ? ('?' + event.rawQueryString) : ''}`);
            const videoId = url.searchParams.get('video_id') || event.queryStringParameters?.video_id;
            if (!videoId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing video_id' })
                };
            }
            const data = await heygen.getVideoStatus(videoId);
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            };
        } catch (err) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'Heygen proxy failed', message: err.message })
            };
        }
    }

    // HeyGen: check avatar group training status
    if (path.includes('/heygen/avatar-group/training-status') && method === 'GET') {
        try {
            const authHeader = event.headers.Authorization || event.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: 'Unauthorized' })
                };
            }

            const idToken = authHeader.split('Bearer ')[1];
            await firebaseInitializer.initialize();
            const admin = require('firebase-admin');
            const decoded = await admin.auth().verifyIdToken(idToken);
            const userId = decoded.uid;

            const url = new URL(event.rawUrl || `${event.headers.origin || 'http://localhost:3001'}${path}${event.rawQueryString ? ('?' + event.rawQueryString) : ''}`);
            const groupDocId = url.searchParams.get('group_id') || event.queryStringParameters?.group_id;
            
            if (!groupDocId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing group_id parameter' })
                };
            }

            const db = admin.firestore();
            const groupDoc = await db.collection('users').doc(userId)
                .collection('heygenAvatarGroups').doc(groupDocId).get();
            
            if (!groupDoc.exists) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Avatar group not found' })
                };
            }

            const groupData = groupDoc.data();
            const heygenGroupId = groupData.avatar_group_id;
            
            if (!heygenGroupId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Avatar group not yet created in HeyGen',
                        status: 'not_started'
                    })
                };
            }

            const trainingStatus = await heygen.getTrainingJobStatus(heygenGroupId);
            const avatars = await heygen.listAvatarsInAvatarGroup(heygenGroupId);

            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: trainingStatus?.status || 'unknown',
                    progress: trainingStatus?.progress || 0,
                    avatar_group_id: heygenGroupId,
                    avatars_count: avatars?.length || 0,
                    avatars: avatars || []
                })
            };
        } catch (err) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Failed to check training status', 
                    message: err.message 
                })
            };
        }
    }

    // HeyGen: list avatars
    if (path.includes('/heygen/avatars') && method === 'GET') {
        try {
            const data = await heygen.listAvatars();
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ avatars: data })
            };
        } catch (err) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'Failed to list HeyGen avatars', message: err.message })
            };
        }
    }

    // HeyGen: list voices
    if (path.includes('/heygen/voices') && method === 'GET') {
        try {
            const data = await heygen.listVoices();
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ voices: data })
            };
        } catch (err) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ error: 'Failed to list HeyGen voices', message: err.message })
            };
        }
    }

    // Unified user event configuration (across providers)
    if (path === '/users/events' && method === 'GET') {
        try {
            const buildUrlFromEvent = () => {
                if (event.rawUrl) return new URL(event.rawUrl);
                const origin = requestOrigin && requestOrigin !== '*' ? requestOrigin : 'https://masky.ai';
                const rawPath = event.rawPath || path || '/users/events';
                const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
                return new URL(`${origin}${rawPath}${query}`);
            };

            let url;
            try {
                url = buildUrlFromEvent();
            } catch (err) {
                console.warn('Failed to construct URL object for /users/events request:', err.message);
            }

            const queryParams = event.queryStringParameters || {};
            const userId = url?.searchParams?.get('userId') || url?.searchParams?.get('uid') || queryParams.userId || queryParams.uid;

            if (!userId || typeof userId !== 'string') {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing userId parameter' })
                };
            }

            await firebaseInitializer.initialize();
            const admin = require('firebase-admin');
            const db = admin.firestore();

            const serializeTimestamp = (value) => {
                if (!value) return null;
                if (typeof value.toDate === 'function') {
                    try { return value.toDate().toISOString(); } catch { return null; }
                }
                if (value instanceof Date) {
                    return value.toISOString();
                }
                if (typeof value === 'string') {
                    return value;
                }
                return null;
            };

            const providerGroups = {};
            const heygenTasks = [];
            const projectsSnapshot = await db.collection('projects')
                .where('userId', '==', userId)
                .where('isActive', '==', true)
                .get();

            if (projectsSnapshot.empty) {
                const emptyResponse = {
                    userId,
                    providers: {},
                    eventTypes: [],
                    generatedAt: new Date().toISOString()
                };

                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store'
                    },
                    body: JSON.stringify(emptyResponse)
                };
            }

            const allEventTypes = new Set();
            const nowIso = new Date().toISOString();

            projectsSnapshot.docs.forEach((doc) => {
                const data = doc.data() || {};
                const platform = (data.platform || 'unknown').toLowerCase();
                const eventType = data.eventType || 'channel.follow';
                const projectType = data.projectType || (data.videoStoragePath ? 'upload' : 'generate');

                if (!providerGroups[platform]) {
                    providerGroups[platform] = {
                        eventTypes: new Set(),
                        projects: []
                    };
                }

                const activeAlertConfig = data.alertConfig?.[eventType] || null;
                const rawMinimumCost = data.channelPointsMinimumCost;
                const parsedMinimumCost = typeof rawMinimumCost === 'number'
                    ? rawMinimumCost
                    : Number.parseInt(rawMinimumCost, 10);
                const projectRecord = {
                    projectId: doc.id,
                    projectName: data.projectName || null,
                    platform,
                    eventType,
                    projectType,
                    commandTrigger: data.commandTrigger || null,
                    isActive: !!data.isActive,
                    twitchSubscription: !!data.twitchSubscription,
                    alertConfig: data.alertConfig || {},
                    activeAlertConfig,
                    channelPointsMinimumCost: Number.isFinite(parsedMinimumCost) && parsedMinimumCost >= 0
                        ? Math.floor(parsedMinimumCost)
                        : null,
                    videoSources: [],
                    heygen: data.heygenVideoId ? {
                        videoId: data.heygenVideoId,
                        status: data.heygenStatus || data.heygenLastStatus || null,
                        ready: !!data.heygenVideoReady,
                        lastCheckedAt: serializeTimestamp(data.heygenLastCheckedAt) || null
                    } : null,
                    metadata: {
                        videoStoragePath: data.videoStoragePath || null,
                        createdAt: serializeTimestamp(data.createdAt),
                        updatedAt: serializeTimestamp(data.updatedAt)
                    }
                };

                providerGroups[platform].eventTypes.add(eventType);
                providerGroups[platform].projects.push(projectRecord);
                allEventTypes.add(`${platform}:${eventType}`);

                if (projectType === 'upload' && data.videoUrl) {
                    projectRecord.videoSources.push({
                        type: 'uploaded',
                        url: data.videoUrl,
                        storagePath: data.videoStoragePath || null,
                        lastCheckedAt: nowIso
                    });
                }

                if (data.heygenVideoId) {
                    const task = {
                        projectRecord,
                        videoId: data.heygenVideoId,
                        lastKnownStatus: data.heygenStatus || data.heygenLastStatus || null
                    };
                    heygenTasks.push(task);
                }
            });

            if (heygenTasks.length) {
                await Promise.all(heygenTasks.map(async (task) => {
                    const { projectRecord, videoId, lastKnownStatus } = task;
                    try {
                        const payload = await heygen.getVideoStatus(videoId);
                        const data = payload?.data || payload || {};
                        const signedUrl = data.video_signed_url?.url || null;
                        const signedExpiry = data.video_signed_url?.expired_time || data.video_signed_url?.expire_time || null;
                        const directUrl = data.video_url || data.videoUrl || null;
                        const resolvedUrl = signedUrl || directUrl || null;
                        const status = data.status || payload?.status || lastKnownStatus || null;

                        const normalizeExpiry = (value) => {
                            if (!value) return null;
                            if (typeof value === 'string') {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed)) {
                                    return parsed > 1e12 ? new Date(parsed).toISOString() : new Date(parsed * 1000).toISOString();
                                }
                                const dateValue = Date.parse(value);
                                if (!Number.isNaN(dateValue)) {
                                    return new Date(dateValue).toISOString();
                                }
                                return value;
                            }
                            if (typeof value === 'number') {
                                return value > 1e12 ? new Date(value).toISOString() : new Date(value * 1000).toISOString();
                            }
                            if (value instanceof Date) {
                                return value.toISOString();
                            }
                            return null;
                        };

                        if (!projectRecord.heygen) {
                            projectRecord.heygen = { videoId, status: null, ready: false, lastCheckedAt: null };
                        }
                        projectRecord.heygen.status = status || null;
                        projectRecord.heygen.ready = resolvedUrl ? true : false;
                        projectRecord.heygen.lastCheckedAt = new Date().toISOString();

                        projectRecord.videoSources.push({
                            type: 'heygen',
                            videoId,
                            status,
                            url: resolvedUrl,
                            lastCheckedAt: new Date().toISOString(),
                            expiresAt: normalizeExpiry(signedExpiry || data.expire_time || data.expired_time || data.expiredTime || null),
                            raw: {
                                video_url: data.video_url || null,
                                video_signed_url: data.video_signed_url || null
                            }
                        });
                    } catch (err) {
                        console.error(`Failed to refresh HeyGen URL for video ${videoId}:`, err.message);
                        if (!projectRecord.heygen) {
                            projectRecord.heygen = { videoId, status: lastKnownStatus || null, ready: false, lastCheckedAt: null };
                        }
                        projectRecord.heygen.status = lastKnownStatus || projectRecord.heygen.status || 'error';
                        projectRecord.heygen.ready = false;
                        projectRecord.heygen.lastCheckedAt = new Date().toISOString();
                        projectRecord.videoSources.push({
                            type: 'heygen',
                            videoId,
                            status: 'error',
                            url: null,
                            lastCheckedAt: new Date().toISOString(),
                            error: err.message || 'Unknown error'
                        });
                    }
                }));
            }

            const providers = {};
            Object.entries(providerGroups).forEach(([platform, info]) => {
                providers[platform] = {
                    eventTypes: Array.from(info.eventTypes),
                    projects: info.projects
                };
            });

            const responseBody = {
                userId,
                providers,
                eventTypes: Array.from(allEventTypes),
                generatedAt: new Date().toISOString()
            };

            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify(responseBody)
            };
        } catch (err) {
            console.error('Failed to load user events:', err);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Failed to load user events',
                    message: err.message
                })
            };
        }
    }

    // HeyGen: generate video (audio source as voice)
    if (path.includes('/heygen/generate') && method === 'POST') {
        const response = await handleHeygenGenerate(event, headers);
        return response;
    }

    // HeyGen: initialize avatar group
    if (path.includes('/heygen/avatar-group/init') && method === 'POST') {
        return await handleHeygenAvatarGroupInit(event, headers);
    }

    // HeyGen: add look to avatar group
    if (path.includes('/heygen/avatar-group/add-look') && method === 'POST') {
        return await handleHeygenAvatarGroupAddLook(event, headers);
    }

    // HeyGen: remove look from avatar group
    if (path.includes('/heygen/avatar-group/remove-look') && method === 'POST') {
        return await handleHeygenAvatarGroupRemoveLook(event, headers);
    }

    // HeyGen: sync assets between Firestore and HeyGen
        if (path.includes('/heygen/avatar-group/sync') && method === 'POST') {
            return await handleHeygenAvatarGroupSync(event, headers);
        }
        
        if (path.includes('/heygen/avatar-group/delete') && method === 'POST') {
            return await handleHeygenAvatarGroupDelete(event, headers);
        }
        
        if (path.includes('/heygen/avatar-group/claim') && method === 'POST') {
            return await handleHeygenAvatarGroupClaim(event, headers);
        }

    // Connected social hook verification
    if (path.includes('/social-hooks/verify') && method === 'POST') {
        return await handleSocialHooksVerify(event, headers);
    }

    // Handle Twitch OAuth (legacy - direct access token)
    if (path.includes('/twitch_oauth') && method === 'POST') {
        const response = await handleTwitchOAuth(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Handle Twitch OAuth GET redirect with query params (code or error)
    if (path.includes('/twitch_oauth') && method === 'GET') {
        console.log('GET /twitch_oauth handler triggered', { path, method, queryString: event.rawQueryString, queryParams: event.queryStringParameters });
        try {
            // Support both API Gateway v1 and v2 styles
            let params;
            if (event.rawQueryString && typeof event.rawQueryString === 'string') {
                params = new URLSearchParams(event.rawQueryString);
            } else if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
                params = new URLSearchParams();
                for (const [k, v] of Object.entries(event.queryStringParameters)) {
                    if (typeof v === 'string') params.append(k, v);
                }
            } else {
                params = new URLSearchParams();
            }

            const error = params.get('error');
            const errorDescription = params.get('error_description');
            const state = params.get('state');
            const accessToken = params.get('access_token');
            const code = params.get('code');

            // If Twitch sent an error, surface it clearly
            if (error) {
                return {
                    statusCode: 400,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ error, errorDescription, state })
                };
            }

            // If implicit flow leaked access_token in query (rare), treat like legacy
            if (accessToken) {
                const legacyEvent = {
                    ...event,
                    httpMethod: 'POST',
                    body: JSON.stringify({ accessToken }),
                    isBase64Encoded: false
                };
                const response = await handleTwitchOAuth(legacyEvent);
                return {
                    ...response,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json'
                    }
                };
            }

            // If authorization code present, invoke callback exchange flow
            if (code) {
                const callbackEvent = {
                    ...event,
                    httpMethod: 'POST',
                    body: JSON.stringify({
                        code,
                        // Use the actual API endpoint as redirect URI
                        redirectUri: 'https://masky.ai/api/twitch_oauth'
                    }),
                    isBase64Encoded: false
                };
                const response = await twitchInitializer.handleOAuthCallback(callbackEvent);
                
                // For GET requests with code parameter, always return HTML popup response
                // since this endpoint is only used for popup OAuth flow
                console.log('OAuth callback received:', {
                    code: !!code,
                    popupParam: params.get('popup'),
                    headers: event.headers,
                    referer: event.headers?.Referer || event.headers?.referer,
                    allParams: Object.fromEntries(params.entries())
                });
                
                // Always return HTML for popup OAuth flow
                // Return HTML page that closes popup and communicates with parent
                const htmlResponse = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Twitch OAuth</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #f0f0f0;
        }
        .debug-info {
            background: white;
            padding: 20px;
            margin: 20px auto;
            max-width: 600px;
            border: 1px solid #ddd;
            border-radius: 8px;
            text-align: left;
            font-size: 12px;
        }
        .debug-info h4 {
            margin-top: 0;
            color: #333;
        }
        .success { color: #28a745; }
        .error { color: #dc3545; }
        .loading { color: #007bff; }
    </style>
</head>
<body>
    <div id="status" class="loading">Processing Twitch authentication...</div>
    <div id="debugInfo" class="debug-info" style="display: none;"></div>
    <script>
        (function() {
            try {
                const response = ${JSON.stringify(response)};
                
                // Show debug info on page
                const debugInfo = document.getElementById('debugInfo');
                debugInfo.style.display = 'block';
                debugInfo.innerHTML = '<h4>Debug Information</h4><pre>' + JSON.stringify({
                    statusCode: response.statusCode,
                    hasOpener: !!window.opener,
                    currentOrigin: window.location.origin,
                    responseKeys: Object.keys(response)
                }, null, 2) + '</pre>';
                
                if (response.statusCode === 200) {
                    // Success - send message to parent and close popup
                    console.log('Processing successful OAuth response:', response);
                    
                    if (window.opener) {
                        try {
                            const userData = response.body ? JSON.parse(response.body) : null;
                            const message = {
                                type: 'TWITCH_OAUTH_SUCCESS',
                                user: userData
                            };
                            
                            console.log('Sending success message to parent:', message);
                            console.log('Target origin:', window.location.origin);
                            console.log('Window opener exists:', !!window.opener);
                            
                            // Use '*' to allow any origin - security is handled by checking event.origin in the receiver
                            window.opener.postMessage(message, '*');
                            console.log('Success message sent to parent');
                        } catch (e) {
                            console.error('Error sending success message:', e);
                        }
                    } else {
                        console.error('No window.opener found - popup may have been opened incorrectly');
                    }
                    document.getElementById('status').innerHTML = '<div class="success">✓ Authentication successful! Closing window in 10 seconds...</div>';
                    // Give more time for the message to be received and for debugging
                    setTimeout(() => {
                        console.log('Closing popup window');
                        window.close();
                    }, 10000);
                } else {
                    // Error - send error message to parent
                    const errorData = response.body ? JSON.parse(response.body) : { error: 'Unknown error' };
                    if (window.opener) {
                        try {
                            // Use '*' to allow any origin - security is handled by checking event.origin in the receiver
                            window.opener.postMessage({
                                type: 'TWITCH_OAUTH_ERROR',
                                error: errorData.error || 'Authentication failed'
                            }, '*');
                            console.log('Error message sent to parent:', errorData.error);
                        } catch (e) {
                            console.error('Error sending error message:', e);
                        }
                    }
                    document.getElementById('status').innerHTML = '<div class="error">✗ Authentication failed: ' + (errorData.error || 'Unknown error') + '</div>';
                    setTimeout(() => {
                        console.log('Closing popup window after error');
                        window.close();
                    }, 10000);
                }
            } catch (err) {
                console.error('Popup error:', err);
                if (window.opener) {
                    // Use '*' to allow any origin - security is handled by checking event.origin in the receiver
                    window.opener.postMessage({
                        type: 'TWITCH_OAUTH_ERROR',
                        error: err.message
                    }, '*');
                }
                document.getElementById('status').innerHTML = '<div class="error">✗ Error: ' + err.message + '</div>';
                setTimeout(() => window.close(), 10000);
            }
        })();
    </script>
</body>
</html>`;
                
                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'text/html'
                    },
                    body: htmlResponse
                };
            }

            // No recognizable params - return helpful message for GET requests
            return {
                statusCode: 400,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    error: 'Invalid request', 
                    message: 'Expected error, code, or access_token query parameters for GET /twitch_oauth' 
                })
            };
        } catch (err) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to process Twitch OAuth redirect', message: err.message })
            };
        }
    }

    // Subscription status endpoint
    if (path.includes('/subscription/status') && method === 'GET') {
        console.log('Subscription status request received');
        const response = await getSubscriptionStatus(event);
        return {
            statusCode: response.statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
                'Content-Type': 'application/json'
            },
            body: response.body
        };
    }

    // Create checkout session
    if (path.includes('/subscription/create-checkout') && method === 'POST') {
        const response = await createCheckoutSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Cancel subscription
    if (path.includes('/subscription/cancel') && method === 'POST') {
        const response = await cancelSubscription(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Create customer portal session
    if (path.includes('/subscription/portal') && method === 'POST') {
        const response = await createPortalSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Stripe webhook
    if (path.includes('/stripe/webhook') && method === 'POST') {
        const response = await handleStripeWebhook(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    

    // Debug endpoint to test Stripe connection
    if (path.includes('/debug/stripe') && method === 'GET') {
        const response = await debugStripeConnection(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Twitch EventSub endpoint
    if (path.includes('/twitch-eventsub') && method === 'POST') {
        const response = await twitchInitializer.createEventSub(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Ensure Twitch chatbot (chat:read/edit) for the current user
    if (path.includes('/twitch-chatbot-ensure') && method === 'POST') {
        try {
            // Verify Firebase token
            const authHeader = event.headers.Authorization || event.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({ error: 'Unauthorized - No token provided' })
                };
            }

            const idToken = authHeader.split('Bearer ')[1];
            await firebaseInitializer.initialize();
            const admin = require('firebase-admin');
            const decoded = await admin.auth().verifyIdToken(idToken);
            const userId = decoded.uid;

            // Ensure the user's Twitch access token exists and has chat scopes
            const userRecord = await admin.auth().getUser(userId);
            const claims = userRecord.customClaims || {};
            const accessToken = claims.twitchAccessToken;
            const twitchId = claims.twitchId;

            if (!accessToken || !twitchId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Twitch not connected', code: 'TWITCH_TOKEN_MISSING' })
                };
            }

            // Validate token scopes
            let validation;
            try {
                validation = await twitchInitializer.validateToken(accessToken);
            } catch (e) {
                // Map invalid/expired token to actionable error for client
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Twitch token invalid or expired. Please reconnect Twitch.',
                        code: 'TWITCH_TOKEN_MISSING'
                    })
                };
            }
            const scopes = Array.isArray(validation.scopes) ? validation.scopes : [];
            const hasChatRead = scopes.includes('chat:read');
            const hasChatEdit = scopes.includes('chat:edit');
            const hasChannelBot = scopes.includes('channel:bot'); // Required for Cloud Chatbots to allow bot to subscribe

            if (!hasChatRead || !hasChatEdit) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing required chat scopes (chat:read, chat:edit). Reconnect Twitch.',
                        code: 'TWITCH_CHAT_SCOPES_MISSING'
                    })
                };
            }

            if (!hasChannelBot) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Missing required scope (channel:bot). This scope grants permission for the bot to subscribe to chat-related EventSub subscriptions. Please reconnect Twitch.',
                        code: 'TWITCH_CHANNEL_BOT_SCOPE_MISSING'
                    })
                };
            }

            // Create EventSub subscription for channel.chat.message to receive all chat messages via webhook
            const db = admin.firestore();
            const subscriptionKey = 'twitch_channel.chat.message';
            const userSubscriptionsRef = db.collection('users').doc(userId).collection('subscriptions').doc(subscriptionKey);
            const existingSubscription = await userSubscriptionsRef.get();

            let subscription;
            let subscriptionCreated = false;

            if (existingSubscription.exists) {
                const existingData = existingSubscription.data();
                const existing = existingData.twitchSubscription || {};
                // Reuse only if same type and currently enabled
                if (existing.type === 'channel.chat.message' && existing.status === 'enabled') {
                    subscription = existing;
                    console.log('Using existing chat message subscription:', subscription.id);
                } else {
                    console.log('Existing chat subscription not enabled or mismatched; will (re)create');
                }
            }

            if (!subscription) {
                // Initialize Twitch credentials from SSM
                await twitchInitializer.initialize();
                const { clientId, clientSecret } = twitchInitializer.getCredentials();
                
                // For Cloud Chatbots with webhook transport, we MUST use an App Access Token
                // per Twitch documentation: "You can only subscribe to events over Webhook transport using an App Access Token"
                // The App Access Token is obtained via client credentials flow (no user context)
                const appToken = await twitchInitializer.getAppAccessToken();
                console.log('Creating EventSub subscription for channel.chat.message');
                console.log('Using App Access Token (client credentials flow)');
                console.log('Client ID:', clientId);
                console.log('App Token (first 20 chars):', appToken.substring(0, 20) + '...');
                
                // Validate app token to ensure Client ID matches
                try {
                    const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
                        headers: { 'Authorization': `OAuth ${appToken}` }
                    });
                    if (validateResponse.ok) {
                        const validateData = await validateResponse.json();
                        console.log('App Token validation:', {
                            client_id: validateData.client_id,
                            matches: validateData.client_id === clientId,
                            scopes: validateData.scopes
                        });
                        if (validateData.client_id !== clientId) {
                            throw new Error(`Client ID mismatch: token has ${validateData.client_id}, expected ${clientId}`);
                        }
                    }
                } catch (e) {
                    console.warn('Could not validate app token:', e.message);
                }
                
                // Bot User ID - the maskyai chatbot account (1386063343)
                // This bot account must have authorized the app with user:read:chat and user:bot scopes
                const botUserId = '1386063343';
                
                // Check if bot account has authorized the app
                const botTokensRef = db.collection('system').doc('bot_tokens');
                const botTokensDoc = await botTokensRef.get();
                let botHasAuthorized = false;
                let botAuthUrl = null;
                
                if (botTokensDoc.exists) {
                    const botTokens = botTokensDoc.data();
                    // Validate bot token has required scopes
                    if (botTokens.accessToken && botTokens.scopes) {
                        const hasUserReadChat = botTokens.scopes.includes('user:read:chat') || 
                                               botTokens.scopes.includes('chat:read');
                        const hasUserBot = botTokens.scopes.includes('user:bot');
                        
                        if (hasUserReadChat && hasUserBot) {
                            botHasAuthorized = true;
                            console.log('Bot account has authorized with required scopes');
                        } else {
                            console.log('Bot account authorized but missing required scopes:', {
                                hasUserReadChat,
                                hasUserBot,
                                scopes: botTokens.scopes
                            });
                        }
                    }
                }
                
                // Generate bot authorization URL if not authorized
                if (!botHasAuthorized) {
                    botAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://masky.ai/api/twitch_oauth')}&response_type=code&scope=${encodeURIComponent('user:read:chat user:bot')}`;
                    console.log('Bot account not authorized. Auth URL:', botAuthUrl);
                }
                
                // Verify bot account exists and can be accessed
                try {
                    const botUserResponse = await fetch(`https://api.twitch.tv/helix/users?id=${botUserId}`, {
                        headers: {
                            'Authorization': `Bearer ${appToken}`,
                            'Client-Id': clientId
                        }
                    });
                    if (botUserResponse.ok) {
                        const botUserData = await botUserResponse.json();
                        console.log('Bot account info:', botUserData.data?.[0] ? {
                            id: botUserData.data[0].id,
                            login: botUserData.data[0].login,
                            display_name: botUserData.data[0].display_name
                        } : 'Bot account not found');
                    } else {
                        console.warn('Could not fetch bot account info:', await botUserResponse.text());
                    }
                } catch (e) {
                    console.warn('Error checking bot account:', e.message);
                }
                
                // For channel.chat.message EventSub subscriptions (Cloud Chatbot pattern):
                // - broadcaster_user_id: The channel owner (broadcaster) who granted channel:bot permission
                // - user_id: The bot's User ID that will receive the chat messages
                //   This bot account must have authorized the app with user:read:chat + user:bot scopes
                //   The bot account authorization must be done with THIS client ID (sgb17aslo6gesnetuqfnf6qql6jrae)
                // - Authorization: App Access Token (required for webhook transport)
                // - Client-Id: Must match the client ID embedded in the app token
                console.log('Subscription condition:', {
                    broadcaster_user_id: twitchId,
                    user_id: botUserId,
                    note: 'Bot account must have authorized this app with user:read:chat + user:bot scopes'
                });
                
                const requestBody = {
                    type: 'channel.chat.message',
                    version: '1',
                    condition: {
                        broadcaster_user_id: twitchId, // The broadcaster's channel
                        user_id: botUserId // Bot account ID - must have authorized with user:read:chat + user:bot
                    },
                    transport: {
                        method: 'webhook',
                        callback: 'https://masky.ai/api/twitch-webhook',
                        secret: clientSecret
                    }
                };

                const requestHeaders = {
                    'Authorization': `Bearer ${appToken}`, // App Access Token (client credentials flow) - FULL TOKEN
                    'Client-Id': clientId, // Must match the client ID in the app token
                    'Content-Type': 'application/json'
                };

                // Log that we're using the full token (for debugging)
                console.log('Request headers prepared:', {
                    'Authorization': `Bearer ${appToken.substring(0, 20)}... (${appToken.length} chars total)`,
                    'Client-Id': clientId,
                    'Content-Type': 'application/json'
                });

                // Check if bot has authorized before attempting subscription
                if (!botHasAuthorized) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({
                            error: 'Bot account not authorized',
                            message: 'The bot account (maskyai) must authorize the app with user:read:chat and user:bot scopes before creating chat subscriptions.',
                            code: 'BOT_ACCOUNT_NOT_AUTHORIZED',
                            botAuthUrl: botAuthUrl,
                            instructions: [
                                '1. Open the bot authorization URL in a browser',
                                '2. Log in as the bot account (maskyai)',
                                '3. Click "Authorize" to grant the required permissions',
                                '4. Try connecting again'
                            ]
                        })
                    };
                }

                const twitchResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(requestBody)
                });

                if (!twitchResponse.ok) {
                    const errorText = await twitchResponse.text();
                    let errorData;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (e) {
                        errorData = { raw: errorText };
                    }
                    
                    // Handle 409 Conflict - subscription already exists
                    if (twitchResponse.status === 409 && errorData.message?.includes('subscription already exists')) {
                        console.log('Subscription already exists in Twitch API, fetching existing subscription...');
                        
                        // Fetch existing subscriptions for this broadcaster and bot
                        const getSubscriptionsResponse = await fetch(
                            `https://api.twitch.tv/helix/eventsub/subscriptions?broadcaster_user_id=${twitchId}&type=channel.chat.message`,
                            {
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${appToken}`,
                                    'Client-Id': clientId
                                }
                            }
                        );
                        
                        if (getSubscriptionsResponse.ok) {
                            const subscriptionsData = await getSubscriptionsResponse.json();
                            // Find the subscription matching our condition (same broadcaster and bot user_id)
                            const matchingSubscription = subscriptionsData.data?.find(sub => 
                                sub.type === 'channel.chat.message' &&
                                sub.condition?.broadcaster_user_id === twitchId &&
                                sub.condition?.user_id === botUserId
                            );
                            
                            if (matchingSubscription) {
                                subscription = matchingSubscription;
                                console.log('Found existing subscription:', subscription.id, 'Status:', subscription.status);
                                
                                // Update Firestore with the existing subscription
                                await userSubscriptionsRef.set({
                                    provider: 'twitch',
                                    eventType: 'channel.chat.message',
                                    twitchSubscription: subscription,
                                    isActive: subscription.status === 'enabled',
                                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                                });
                                
                                console.log('Updated Firestore with existing subscription:', subscription.id);
                            } else {
                                console.warn('Subscription exists in Twitch but could not find matching subscription in API response');
                                // Fall through to throw error
                                throw new Error('Subscription already exists but could not retrieve details');
                            }
                        } else {
                            console.warn('Failed to fetch existing subscriptions:', await getSubscriptionsResponse.text());
                            // Fall through to throw error
                            throw new Error('Subscription already exists but could not retrieve details');
                        }
                    } else {
                        // Handle other errors
                        console.error('Failed to create chat message subscription. Status:', twitchResponse.status, 'Response:', JSON.stringify(errorData, null, 2));
                        console.error('Request body sent:', JSON.stringify(requestBody, null, 2));
                        
                        // Include full request payload in error for debugging
                        const twitchPayload = {
                            url: 'https://api.twitch.tv/helix/eventsub/subscriptions',
                            method: 'POST',
                            headers: {
                                ...requestHeaders,
                                'Authorization': `Bearer ${appToken.substring(0, 20)}...` // Only show first 20 chars of token
                            },
                            body: requestBody
                        };
                        
                        // Provide detailed error message with troubleshooting steps
                        let errorMessage = `Twitch API error: ${errorData.message || errorData.error || 'Unknown error'}`;
                        if (twitchResponse.status === 403 && errorData.message?.includes('authorization')) {
                            errorMessage += `\n\nThe bot account (ID: ${botUserId}) must authorize your app.`;
                            if (!botAuthUrl) {
                                botAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://masky.ai/api/twitch_oauth')}&response_type=code&scope=${encodeURIComponent('user:read:chat user:bot')}`;
                            }
                        }
                        
                        const error = new Error(errorMessage);
                        error.twitchPayload = twitchPayload;
                        error.twitchResponse = errorData;
                        error.twitchStatus = twitchResponse.status;
                        error.botAuthUrl = botAuthUrl || `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://masky.ai/api/twitch_oauth')}&response_type=code&scope=${encodeURIComponent('user:read:chat user:bot')}`;
                        throw error;
                    }
                } else {
                    // Successfully created new subscription
                    const subscriptionData = await twitchResponse.json();
                    subscription = subscriptionData.data[0];
                    subscriptionCreated = true;
                    
                    // Save subscription to user's subscriptions collection
                    await userSubscriptionsRef.set({
                        provider: 'twitch',
                        eventType: 'channel.chat.message',
                        twitchSubscription: subscription,
                        isActive: true,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    
                    console.log('Created new chat message subscription:', subscription.id);
                }
            }

            // Mark chatbot as established for this user
            await db.collection('users').doc(userId).set({
                chatbotEstablished: true,
                twitchId: twitchId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    ok: true, 
                    chatbotEstablished: true,
                    subscription: subscription,
                    subscriptionCreated: subscriptionCreated
                })
            };
        } catch (err) {
            console.error('Error ensuring Twitch chatbot:', err);
            const errorResponse = { 
                error: 'Failed to ensure Twitch chatbot', 
                message: err.message 
            };
            
            // Include Twitch API debugging info if available
            if (err.twitchPayload) {
                errorResponse.twitch_payload = err.twitchPayload;
            }
            if (err.twitchResponse) {
                errorResponse.twitch_response = err.twitchResponse;
            }
            if (err.twitchStatus) {
                errorResponse.twitch_status = err.twitchStatus;
            }
            if (err.botAuthUrl) {
                errorResponse.bot_auth_url = err.botAuthUrl;
            }
            
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify(errorResponse)
            };
        }
    }

    // Twitch webhook endpoint
    if (path.includes('/twitch-webhook') && method === 'POST') {
        const response = await twitchInitializer.handleWebhook(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Voice upload endpoint
    if (path.includes('/upload-voice') && method === 'POST') {
        const response = await handleVoiceUpload(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Avatar upload endpoint
    if (path.includes('/upload-avatar') && method === 'POST') {
        const response = await handleAvatarUpload(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    

    // Default response for unmatched routes
    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Route not found' })
    };
}

/**
 * Generate HeyGen video using audio_url. Optionally records avatar mapping.
 */
async function handleHeygenGenerate(event, headers) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(idToken);
        const userId = decoded.uid;

        // Parse request body
        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }

        let {
            projectId,
            voiceUrl: voiceUrlInput,
            heygenAvatarId,  // This might be a HeyGen avatar ID OR a Firestore asset ID
            userAvatarUrl: userAvatarUrlInput,
            avatarGroupId: avatarGroupIdInput,
            width: rawWidth,
            height: rawHeight,
            avatarStyle = 'normal',
            aspectRatio: rawAspectRatio
        } = body;

        let width = Number(rawWidth);
        let height = Number(rawHeight);
        if (!Number.isFinite(width) || width <= 0) {
            width = 720;   // Default to 720p width for HeyGen free/basic tier compatibility
        }
        if (!Number.isFinite(height) || height <= 0) {
            height = 1280; // Default to portrait orientation
        }

        let requestedAspectRatio = Number(rawAspectRatio);
        if (!Number.isFinite(requestedAspectRatio) || requestedAspectRatio <= 0) {
            requestedAspectRatio = null;
        }

        const trainingPendingResponse = ({ trainingStatus, groupDocId, heygenGroupId: responseHeygenGroupId } = {}) => {
            const statusEndpoint = groupDocId
                ? `/api/heygen/avatar-group/training-status?group_id=${encodeURIComponent(groupDocId)}`
                : null;
            return {
                statusCode: 202,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: 'training_pending',
                    message: 'Avatar training is still in progress. Video generation will begin automatically once training completes.',
                    trainingStatus: trainingStatus?.status || null,
                    progress: typeof trainingStatus?.progress === 'number' ? trainingStatus.progress : null,
                    groupId: groupDocId || null,
                    heygenGroupId: responseHeygenGroupId || null,
                    retryAfterSeconds: 10,
                    statusEndpoint,
                    canPoll: !!statusEndpoint
                })
            };
        };

        console.log('🎬 Generate request received:', {
            projectId,
            heygenAvatarId: heygenAvatarId || '(not provided)',
            avatarGroupId: avatarGroupIdInput || '(not provided)',
            hasVoiceUrl: !!voiceUrlInput
        });

        if (!projectId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'projectId is required' }) };
        }
        // Load project to get defaults (projectName, urls) if not provided
        const db = admin.firestore();
        const projectDoc = await db.collection('projects').doc(projectId).get();
        const projectData = projectDoc.exists ? projectDoc.data() : {};
        const projectName = projectData?.projectName || 'Masky Video';
        const voiceUrl = voiceUrlInput || projectData?.voiceUrl;
        const userAvatarUrl = userAvatarUrlInput || projectData?.avatarUrl;
        const avatarGroupId = avatarGroupIdInput || projectData?.avatarGroupId;

        if (!voiceUrl) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'voiceUrl is required' }) };
        }

        // Ensure per-user folder exists in HeyGen
        let folderId = null;
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();
        const userRec = userSnap.exists ? userSnap.data() : {};
        if (userRec.heygenFolderId) {
            folderId = userRec.heygenFolderId;
        } else {
            try {
                folderId = await heygen.createFolder(`masky_${userId}`);
                await userRef.set({ heygenFolderId: folderId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            } catch (e) {
                console.warn('Failed to create HeyGen folder; proceeding without folder:', e.message);
            }
        }

        // If client passed both mapping parts, persist mapping for future use
        if (heygenAvatarId && userAvatarUrl) {
            await db.collection('users').doc(userId).collection('heygenAvatars').add({
                userId,
                avatarUrl: userAvatarUrl,
                heygenAvatarId,
                name: `masky_${userId}_${Math.abs([...userAvatarUrl].reduce((h, c) => ((h<<5)-h + c.charCodeAt(0))|0, 0))}`,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        let resolvedAvatarId = null;
        let heygenGroupId = null;

        // If we have both heygenAvatarId and avatarGroupId, treat heygenAvatarId as a Firestore asset ID
        // and look up the actual HeyGen avatar ID from the group
        if (heygenAvatarId && avatarGroupIdInput) {
            console.log('🔍 Looking up HeyGen avatar ID for Firestore asset:', heygenAvatarId, 'in group:', avatarGroupIdInput);
            
            const groupsRef = userRef.collection('heygenAvatarGroups');
            const groupDoc = await groupsRef.doc(avatarGroupIdInput).get();
            
            if (groupDoc.exists) {
                const groupData = groupDoc.data();
                heygenGroupId = groupData.avatar_group_id;
                
                if (heygenGroupId) {
                    console.log('✅ Found HeyGen group ID:', heygenGroupId);
                    console.log('   Firestore group doc ID:', avatarGroupIdInput);
                    
                    // Get the asset document to find its URL
                    const assetsRef = groupDoc.ref.collection('assets');
                    const assetDoc = await assetsRef.doc(heygenAvatarId).get();
                    
                    if (assetDoc.exists) {
                        const assetData = assetDoc.data();
                        const assetUrl = assetData.url;
                        console.log('Found asset data:', {
                            url: assetUrl,
                            heygenPhotoAvatarId: assetData.heygenPhotoAvatarId || '(not saved)',
                            heygenStatus: assetData.heygenStatus || '(not saved)',
                            width: assetData.width || '(not saved)',
                            height: assetData.height || '(not saved)'
                        });
                        
                        // If we have the HeyGen photo avatar ID saved, use it directly!
                            if (assetData.heygenPhotoAvatarId) {
                            resolvedAvatarId = assetData.heygenPhotoAvatarId;
                            console.log('✅ Using saved HeyGen photo avatar ID:', resolvedAvatarId);
                            console.log('   Status:', assetData.heygenStatus || 'unknown');
                            
                            // Use the asset's original dimensions if available
                                if (assetData.width && assetData.height) {
                                    const assetWidth = Number(assetData.width);
                                    const assetHeight = Number(assetData.height);
                                    if (Number.isFinite(assetWidth) && Number.isFinite(assetHeight) && assetWidth > 0 && assetHeight > 0) {
                                        width = assetWidth;
                                        height = assetHeight;
                                        console.log('   Using asset dimensions:', width, 'x', height);
                                        if (assetData.aspectRatio && Number.isFinite(Number(assetData.aspectRatio)) && Number(assetData.aspectRatio) > 0) {
                                            requestedAspectRatio = Number(assetData.aspectRatio);
                                        } else {
                                            requestedAspectRatio = Number((width / height).toFixed(6));
                                        }
                                    }
                                }
                            
                            // Check if the photo avatar is ready
                            if (assetData.heygenStatus === 'pending') {
                                console.log('⚠️  Photo avatar status is pending - may still be processing');
                            }
                        } else {
                            console.log('⚠️  No HeyGen photo avatar ID saved in Firestore asset. Querying HeyGen API...');
                            
                            // Fallback: List all avatars in the HeyGen group to find the matching one
                            const groupAvatars = await heygen.listAvatarsInAvatarGroup(heygenGroupId);
                            console.log('Avatars in HeyGen group:', JSON.stringify(groupAvatars, null, 2));
                            
                            // If no avatars, check training status
                            if (!groupAvatars || groupAvatars.length === 0) {
                                console.log('📊 No avatars found, checking training status...');
                                let trainingStatus = null;
                                try {
                                    trainingStatus = await heygen.getTrainingJobStatus(heygenGroupId);
                                    console.log('Training status:', JSON.stringify(trainingStatus, null, 2));
                                } catch (statusErr) {
                                    console.log('Could not get training status:', statusErr.message);
                                }
                                
                                if (trainingStatus && trainingStatus.status && trainingStatus.status !== 'completed') {
                                    console.log('Avatar training still in progress; returning 202 response to client.');
                                    return trainingPendingResponse({
                                        trainingStatus,
                                        groupDocId: avatarGroupIdInput,
                                        heygenGroupId
                                    });
                                }
                                
                                if (trainingStatus && trainingStatus.status === 'completed') {
                                    throw new Error('Training is marked as completed but no avatars found in the group. This may indicate a HeyGen API issue. Please try re-uploading the image.');
                                }
                                
                                throw new Error('No avatars found and training status unknown. Please ensure the avatar was uploaded correctly and training was initiated.');
                            }
                            
                            if (groupAvatars && groupAvatars.length > 0) {
                                // Try to match by name, or just use the first completed avatar
                                // HeyGen avatars have 'avatar_id', 'avatar_name', 'name', etc.
                                const matchingAvatar = groupAvatars.find(a => 
                                    a.name === heygenAvatarId || 
                                    a.avatar_name === heygenAvatarId ||
                                    a.id === heygenAvatarId
                                );
                                
                                // If no match, use first completed avatar
                                const avatarToUse = matchingAvatar || groupAvatars.find(a => a.status === 'completed') || groupAvatars[0];
                                
                                resolvedAvatarId = avatarToUse.avatar_id || avatarToUse.id;
                                console.log('✓ Resolved HeyGen avatar ID from API query:', resolvedAvatarId, 'from avatar:', JSON.stringify(avatarToUse, null, 2));
                            } else {
                                console.error('❌ No avatars found in HeyGen group - group may need training');
                                throw new Error('No avatars found in avatar group. Please ensure the avatar group has been trained and avatars are available.');
                            }
                        }
                    } else {
                        console.warn('Asset document not found:', heygenAvatarId);
                    }
                } else {
                    console.error('❌ Group has no avatar_group_id yet - group not synced with HeyGen');
                    throw new Error(`Avatar group ${avatarGroupIdInput} has not been synced with HeyGen yet. Please try uploading an image to the group first.`);
                }
            } else {
                console.error('❌ Avatar group document not found:', avatarGroupIdInput);
                throw new Error(`Avatar group ${avatarGroupIdInput} not found in your account.`);
            }
        }
        // If only heygenAvatarId provided (no group), assume it's already a HeyGen avatar ID
        else if (heygenAvatarId && !avatarGroupIdInput) {
            console.log('✓ Using directly provided HeyGen avatar ID (no group):', heygenAvatarId);
            resolvedAvatarId = heygenAvatarId;
        }
        // If only avatarGroupId provided, look up an avatar from the group
        else if (!heygenAvatarId && avatarGroupIdInput) {
            console.log('Looking up avatar from group ID (no asset specified):', avatarGroupIdInput);
            const groupsRef = userRef.collection('heygenAvatarGroups');
            const groupDoc = await groupsRef.doc(avatarGroupIdInput).get();
            
            if (groupDoc.exists) {
                const groupData = groupDoc.data();
                heygenGroupId = groupData.avatar_group_id;
                
                if (heygenGroupId) {
                    console.log('Found HeyGen avatar_group_id:', heygenGroupId);
                    
                    // List avatars in the group and pick one
                    const groupAvatars = await heygen.listAvatarsInAvatarGroup(heygenGroupId);
                    console.log('Group avatars from HeyGen:', JSON.stringify(groupAvatars, null, 2));
                    
                    if (groupAvatars && groupAvatars.length > 0) {
                        // Choose first avatar from the group
                        const selected = groupAvatars[0];
                        resolvedAvatarId = selected.avatar_id || selected.id;
                        console.log('Selected avatar from group:', resolvedAvatarId);
                        
                        // Check if avatar needs training
                                if (selected.status && selected.status !== 'completed') {
                                    console.warn('Avatar may not be fully trained. Status:', selected.status);
                                    try {
                                        const trainingStatus = await heygen.getTrainingJobStatus(heygenGroupId);
                                        console.log('Training status:', JSON.stringify(trainingStatus, null, 2));
                                        if (trainingStatus?.status && trainingStatus.status !== 'completed') {
                                            console.log('Avatar group still training; returning 202 response.');
                                            return trainingPendingResponse({
                                                trainingStatus,
                                                groupDocId: avatarGroupIdInput,
                                                heygenGroupId
                                            });
                                        }
                                    } catch (trainingErr) {
                                        console.warn('Could not check training status:', trainingErr.message);
                                    }
                                }
                    } else {
                        console.error('No avatars found in group:', heygenGroupId);
                    }
                } else {
                    console.warn('Group document exists but has no avatar_group_id:', avatarGroupId);
                }
            } else {
                console.error('Avatar group document not found:', avatarGroupId);
            }
        }

        // Legacy fallback: If no HeyGen avatar id resolved yet and we have userAvatarUrl, try to find an existing mapping
        // NOTE: This path should rarely be reached now that we look up avatars from groups
        if (!resolvedAvatarId && userAvatarUrl && !avatarGroupIdInput) {
            console.log('⚠️  Legacy path: No avatar resolved yet, trying to find by avatarUrl:', userAvatarUrl);
            // Use avatar groups flow - lookup group for this asset
            const groupsRef = userRef.collection('heygenAvatarGroups');
            const existing = await groupsRef.where('avatarUrl', '==', userAvatarUrl).limit(1).get();
            let groupDocIdForLegacy = null;
            
            if (!existing.empty) {
                groupDocIdForLegacy = existing.docs[0].id;
                heygenGroupId = existing.docs[0].data().avatar_group_id || existing.docs[0].data().groupId;
                console.log('Found existing group by avatarUrl:', heygenGroupId);
            } else {
                // create group (name per user once) and add look for this asset
                console.log('Creating new avatar group for user:', userId);
                const groupName = `masky_${userId}`;
                heygenGroupId = await heygen.createPhotoAvatarGroup(groupName);
                const createdGroupDoc = await groupsRef.add({
                    userId,
                    avatarUrl: userAvatarUrl,
                    avatar_group_id: heygenGroupId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                groupDocIdForLegacy = createdGroupDoc.id;
                await heygen.addLooksToPhotoAvatarGroup(heygenGroupId, [{ url: userAvatarUrl }]);
                
                // Start training the avatar group (required before avatars can be used)
                try {
                    console.log('Starting training for new avatar group:', heygenGroupId);
                    await heygen.trainPhotoAvatarGroup(heygenGroupId);
                    console.log('Training initiated for avatar group:', heygenGroupId);
                } catch (trainErr) {
                    console.warn('Failed to start training for avatar group:', trainErr.message);
                    // Continue anyway - training might already be in progress
                }
            }

            // Ensure the asset look exists in the group (idempotent add)
            try {
                await heygen.addLooksToPhotoAvatarGroup(heygenGroupId, [{ url: userAvatarUrl }]);
            } catch {}

            // List avatars in the group and pick one
            const groupAvatars = await heygen.listAvatarsInAvatarGroup(heygenGroupId);
            console.log('Group avatars from HeyGen:', JSON.stringify(groupAvatars, null, 2));
            if (groupAvatars && groupAvatars.length > 0) {
                // choose most recent if timestamps available; else first
                const selected = groupAvatars[0];
                resolvedAvatarId = selected.avatar_id || selected.id;
                console.log('Selected avatar from group:', resolvedAvatarId, 'Full object:', JSON.stringify(selected, null, 2));
                
                // Check if avatar needs training
                if (selected.status && selected.status !== 'completed') {
                    console.warn('Avatar group avatar may not be fully trained. Status:', selected.status);
                    try {
                        const trainingStatus = await heygen.getTrainingJobStatus(heygenGroupId);
                        console.log('Training status:', JSON.stringify(trainingStatus, null, 2));
                        if (trainingStatus?.status && trainingStatus.status !== 'completed') {
                            console.log('Legacy avatar group still training; returning 202 response.');
                            return trainingPendingResponse({
                                trainingStatus,
                                groupDocId: groupDocIdForLegacy,
                                heygenGroupId
                            });
                        }
                    } catch (trainingErr) {
                        // If training status check fails, log but continue
                        console.warn('Could not check training status:', trainingErr.message);
                    }
                }
            }
        }

        // If still no avatar id, fallback to a public avatar to avoid blocking first run
        let fallbackUsed = false;
        if (!resolvedAvatarId) {
            try {
                const avatars = await heygen.listAvatars();
                if (Array.isArray(avatars) && avatars.length > 0) {
                    // Prefer obviously public avatars if fields exist; otherwise use first
                    const preferred = avatars.find(a => (a.avatar_id || '').includes('public')) || avatars[0];
                    resolvedAvatarId = preferred.avatar_id || preferred.id;
                    fallbackUsed = true;
                    console.log('HeyGen: using fallback public avatar:', resolvedAvatarId);
                }
            } catch (e) {
                // ignore and keep unresolved
            }
        }

        if (!resolvedAvatarId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'HEYGEN_AVATAR_REQUIRED',
                    message: 'Provide heygenAvatarId or pre-associate your image with a HeyGen avatar.',
                    hint: 'Use GET /api/heygen/avatars to choose a public avatar, or save a mapping in Firestore.'
                })
            };
        }

        // Use audio URL directly (no need to upload audio files to HeyGen)
        console.log('Generating video with audio URL directly:', voiceUrl);
        
        // Determine if this is a photo avatar (user-uploaded) or regular HeyGen avatar
        // Photo avatars come from avatar groups, regular avatars are HeyGen's stock avatars
        const isPhotoAvatar = !!(avatarGroupIdInput || heygenGroupId);
        
        // Scale down dimensions if they exceed HeyGen plan limits while maintaining aspect ratio
        // Free/Basic tier: 720p max (longer side <= 1280)
        // Creator tier: 1080p max (longer side <= 1920)
        const MAX_DIMENSION_720P = 1280;   // Free/Basic tier limit
        const MAX_DIMENSION_1080P = 1920;  // Creator tier limit
        
        // Get user's subscription tier to determine max resolution
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const subscriptionTier = userData.subscriptionTier || 'free';
        
        // Determine max dimension based on subscription
        const hasSubscription = subscriptionTier && subscriptionTier !== 'free';
        let userMaxDimension = MAX_DIMENSION_720P;  // Default to free tier
        if (subscriptionTier === 'standard' || subscriptionTier === 'pro' || hasSubscription) {
            userMaxDimension = MAX_DIMENSION_1080P;  // Allow 1080p for paid tiers
        }
        
        const planMaxDimension = hasSubscription ? MAX_DIMENSION_1080P : MAX_DIMENSION_720P;
        const effectiveMaxDimension = Math.min(userMaxDimension, planMaxDimension);

        if (requestedAspectRatio && Number.isFinite(requestedAspectRatio) && requestedAspectRatio > 0) {
            const currentRatio = Number.isFinite(width) && Number.isFinite(height) && height !== 0
                ? width / height
                : null;

            if (!Number.isFinite(currentRatio) || Math.abs(currentRatio - requestedAspectRatio) > 0.01) {
                const longSide = Math.max(width, height, effectiveMaxDimension);
                if (requestedAspectRatio >= 1) {
                    width = longSide;
                    height = Math.max(1, Math.round(longSide / requestedAspectRatio));
                } else {
                    height = longSide;
                    width = Math.max(1, Math.round(longSide * requestedAspectRatio));
                }
                console.log('🔁 Adjusted dimensions to honor requested aspect ratio:', {
                    requestedAspectRatio,
                    adjustedWidth: width,
                    adjustedHeight: height
                });
            }
        }

        const originalWidth = width;
        const originalHeight = height;
        const normalizedDimensions = heygen.normalizeDimensions(width, height, effectiveMaxDimension, {
            fallbackWidth: 1280,
            fallbackHeight: 720
        });
        
        width = normalizedDimensions.width;
        height = normalizedDimensions.height;
        requestedAspectRatio = Number.isFinite(width) && Number.isFinite(height) && height !== 0
            ? Number((width / height).toFixed(6))
            : requestedAspectRatio;
        
        console.log('📊 Subscription tier:', subscriptionTier, '→ User max dimension:', userMaxDimension);
        console.log('🏷️ Assumed HeyGen plan max dimension:', planMaxDimension, '→ Effective cap:', effectiveMaxDimension);
        console.log('📐 Original dimensions:', originalWidth, 'x', originalHeight, requestedAspectRatio ? `(aspect ${requestedAspectRatio})` : '');
        
        if (normalizedDimensions.wasAdjusted) {
            console.log('📐 Scaled down:', originalWidth, 'x', originalHeight, '→', width, 'x', height, '(preserving aspect ratio)');
        } else {
            console.log('✓ Dimensions within plan limit, using original size');
        }
        
        console.log('🎬 Calling HeyGen generate:', {
            avatarId: resolvedAvatarId,
            isPhotoAvatar: isPhotoAvatar,
            avatarType: isPhotoAvatar ? 'talking_photo' : 'avatar',
            dimensions: `${width}x${height}`,
            aspectRatio: requestedAspectRatio || 'n/a'
        });
        
        const videoId = await heygen.generateVideoWithAudio({
            avatarId: resolvedAvatarId,
            audioUrl: voiceUrl,
            width,
            height,
            avatarStyle,
            isPhotoAvatar: isPhotoAvatar,
            maxDimensionOverride: effectiveMaxDimension,
            planMaxDimension
        });

        // Persist to project
        const projectRef = db.collection('projects').doc(projectId);
        await projectRef.set({
            heygenVideoId: videoId,
            heygenStatus: 'pending',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ videoId, fallbackAvatarUsed: fallbackUsed })
        };
    } catch (err) {
        console.error('HeyGen generate error:', err);
        console.error('Error stack:', err.stack);
        console.error('Error details:', err.details);
        
        // Extract error message properly
        let errorMessage = 'Unknown error';
        let errorDetails = null;
        
        if (err.message) {
            // If message is a string, use it
            if (typeof err.message === 'string') {
                errorMessage = err.message;
            } else {
                // If message is an object, stringify it
                errorMessage = JSON.stringify(err.message);
            }
        }
        
        // Check for details object (from HeyGen API errors)
        if (err.details) {
            errorDetails = err.details;
            // Try to extract a more specific error message from details
            if (err.details.error) {
                if (typeof err.details.error === 'string') {
                    errorMessage = err.details.error;
                } else if (err.details.error.message) {
                    errorMessage = err.details.error.message;
                } else if (err.details.error.code) {
                    errorMessage = `${err.details.error.code}: ${err.details.error.message || 'Unknown error'}`;
                }
            } else if (err.details.message) {
                errorMessage = err.details.message;
            }
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to generate HeyGen video', 
                message: errorMessage,
                details: errorDetails
            })
        };
    }
}


/**
 * Get subscription status for a user
 */
async function getSubscriptionStatus(event) {
    try {
        console.log('Getting subscription status, headers:', JSON.stringify(event.headers));
        
        // Verify Firebase token - API Gateway normalizes headers to lowercase
        const authHeader = event.headers.Authorization || event.headers.authorization;
        
        if (!authHeader) {
            console.error('No authorization header found');
            return {
                statusCode: 401,
                body: JSON.stringify({ 
                    error: 'Unauthorized - No token provided',
                    debug: 'No Authorization header found in request'
                })
            };
        }
        
        if (!authHeader.startsWith('Bearer ')) {
            console.error('Invalid authorization header format:', authHeader.substring(0, 20));
            return {
                statusCode: 401,
                body: JSON.stringify({ 
                    error: 'Unauthorized - Invalid token format',
                    debug: 'Authorization header must start with "Bearer "'
                })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        // Verify the token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Get user's custom claims (where we store subscription info)
        const userRecord = await admin.auth().getUser(userId);
        const customClaims = userRecord.customClaims || {};

        // If no subscription data in custom claims, check Firestore
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data() || {};

        let subscription = {
            tier: customClaims.subscriptionTier || userData.subscriptionTier || 'free',
            status: customClaims.subscriptionStatus || userData.subscriptionStatus || 'active',
            stripeCustomerId: customClaims.stripeCustomerId || userData.stripeCustomerId,
            stripeSubscriptionId: customClaims.stripeSubscriptionId || userData.stripeSubscriptionId,
            currentPeriodEnd: customClaims.currentPeriodEnd || userData.currentPeriodEnd,
            cancelAtPeriodEnd: customClaims.cancelAtPeriodEnd || userData.cancelAtPeriodEnd || false
        };

        console.log('Initial subscription data from Firebase:', JSON.stringify(subscription, null, 2));
        console.log('Custom claims:', JSON.stringify(customClaims, null, 2));
        console.log('User data from Firestore:', JSON.stringify(userData, null, 2));

        // If we have a Stripe subscription ID, fetch latest data from Stripe to ensure accuracy
        if (subscription.stripeSubscriptionId) {
            try {
                console.log('Fetching subscription details from Stripe for ID:', subscription.stripeSubscriptionId);
                const { stripe } = await stripeInitializer.initialize();
                
                // Retrieve subscription with expanded data to get all billing information
                const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
                    expand: ['latest_invoice', 'customer', 'default_payment_method']
                });
                
                console.log('Full Stripe subscription object:', JSON.stringify(stripeSubscription, null, 2));
                console.log('Stripe subscription keys:', Object.keys(stripeSubscription));
                console.log('current_period_end:', stripeSubscription.current_period_end);
                console.log('current_period_start:', stripeSubscription.current_period_start);
                console.log('cancel_at_period_end:', stripeSubscription.cancel_at_period_end);
                console.log('status:', stripeSubscription.status);
                
                // Handle current_period_end - it might be undefined for some subscriptions
                let currentPeriodEnd = stripeSubscription.current_period_end;
                
                // If current_period_end is undefined, try to get it from the latest invoice
                if (!currentPeriodEnd && stripeSubscription.latest_invoice) {
                    console.log('current_period_end is undefined, checking latest invoice');
                    const invoice = stripeSubscription.latest_invoice;
                    if (invoice.lines && invoice.lines.data && invoice.lines.data.length > 0) {
                        const lineItem = invoice.lines.data[0];
                        if (lineItem.period && lineItem.period.end) {
                            currentPeriodEnd = lineItem.period.end;
                            console.log('Found period end from invoice:', currentPeriodEnd);
                        }
                    }
                }
                
                // If still no period end, calculate it from start date + interval
                if (!currentPeriodEnd && stripeSubscription.current_period_start && stripeSubscription.plan) {
                    console.log('Calculating period end from start date and plan interval');
                    const startTime = stripeSubscription.current_period_start;
                    const interval = stripeSubscription.plan.interval;
                    const intervalCount = stripeSubscription.plan.interval_count || 1;
                    
                    // Use a more accurate calculation
                    const startDate = new Date(startTime * 1000);
                    let periodEnd;
                    
                    if (interval === 'month') {
                        const endDate = new Date(startDate);
                        endDate.setMonth(endDate.getMonth() + intervalCount);
                        periodEnd = Math.floor(endDate.getTime() / 1000);
                    } else if (interval === 'year') {
                        const endDate = new Date(startDate);
                        endDate.setFullYear(endDate.getFullYear() + intervalCount);
                        periodEnd = Math.floor(endDate.getTime() / 1000);
                    } else if (interval === 'week') {
                        periodEnd = startTime + (intervalCount * 7 * 24 * 60 * 60);
                    } else if (interval === 'day') {
                        periodEnd = startTime + (intervalCount * 24 * 60 * 60);
                    } else {
                        // Fallback to approximate calculation
                        periodEnd = startTime + (intervalCount * 30 * 24 * 60 * 60);
                    }
                    
                    currentPeriodEnd = periodEnd;
                    console.log('Calculated period end:', currentPeriodEnd, 'from start:', startTime, 'interval:', interval, 'count:', intervalCount);
                }
                
                subscription.currentPeriodEnd = currentPeriodEnd;
                subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
                subscription.status = stripeSubscription.status;
                
                console.log('Final currentPeriodEnd value:', subscription.currentPeriodEnd);

                // Update the data in Firebase for future requests (only if we have valid data)
                const updateData = {
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    subscriptionStatus: stripeSubscription.status
                };
                
                // Only add currentPeriodEnd if we have a valid value
                if (currentPeriodEnd) {
                    updateData.currentPeriodEnd = currentPeriodEnd;
                }
                
                await db.collection('users').doc(userId).update(updateData);

                // Update custom claims (only if we have valid data)
                const claimsUpdate = {
                    ...customClaims,
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    subscriptionStatus: stripeSubscription.status
                };
                
                // Only add currentPeriodEnd if we have a valid value
                if (currentPeriodEnd) {
                    claimsUpdate.currentPeriodEnd = currentPeriodEnd;
                }
                
                await admin.auth().setCustomUserClaims(userId, claimsUpdate);

                console.log('Updated subscription data from Stripe for user:', userId);
            } catch (error) {
                console.error('Error fetching subscription from Stripe:', error);
                // Continue with existing data if Stripe fetch fails
            }
        }

        console.log('Returning subscription data:', JSON.stringify(subscription, null, 2));
        
        return {
            statusCode: 200,
            body: JSON.stringify({ subscription })
        };

    } catch (error) {
        console.error('Error getting subscription status:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to get subscription status',
                message: error.message 
            })
        };
    }
}

async function handleSocialHooksVerify(event, headers) {
    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(idToken);
        const userId = decoded.uid;

        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = bodyString ? JSON.parse(bodyString) : {};
        } else {
            body = event.body || {};
        }

        const rawSubscriptions = Array.isArray(body.subscriptions)
            ? body.subscriptions
            : (body.subscription ? [body.subscription] : []);

        if (!rawSubscriptions.length) {
            return {
                statusCode: 400,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'No subscriptions provided' })
            };
        }

        const groupedByProvider = rawSubscriptions.reduce((acc, sub) => {
            const provider = (sub.provider || '').toLowerCase() || 'unknown';
            if (!acc[provider]) acc[provider] = [];
            acc[provider].push(sub);
            return acc;
        }, {});

        const db = admin.firestore();
        const results = [];

        if (groupedByProvider.twitch) {
            const twitchResults = await verifyTwitchSubscriptions(groupedByProvider.twitch, {
                admin,
                db,
                userId
            });
            results.push(...twitchResults);
        }

        for (const [provider, items] of Object.entries(groupedByProvider)) {
            if (provider === 'twitch') continue;
            for (const item of items) {
                results.push({
                    provider,
                    docId: item.docId || item.id || null,
                    subscriptionId: item.subscriptionId || item.id || null,
                    eventType: item.eventType || null,
                    error: 'unsupported_provider'
                });
            }
        }

        return {
            statusCode: 200,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ results })
        };
    } catch (error) {
        console.error('handleSocialHooksVerify error:', error);
        return {
            statusCode: 500,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'SocialHooksVerificationFailed',
                message: error.message
            })
        };
    }
}

async function verifyTwitchSubscriptions(items, { admin, db, userId }) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    const results = [];
    let appToken;
    let clientId;

    try {
        await twitchInitializer.initialize();
        const credentials = twitchInitializer.getCredentials();
        clientId = credentials.clientId;
        appToken = await twitchInitializer.getAppAccessToken();
    } catch (err) {
        console.error('Failed to prepare Twitch verification:', err);
        return items.map(item => ({
            provider: 'twitch',
            docId: item.docId || item.id || null,
            subscriptionId: item.subscriptionId || item.id || null,
            eventType: item.eventType || null,
            error: 'twitch_credentials_error',
            message: err.message
        }));
    }

    for (const item of items) {
        const expectedEventType = item.eventType || null;
        const docId = item.docId || item.id || (expectedEventType ? `twitch_${expectedEventType}` : null);
        const subscriptionId = item.subscriptionId || item.id || null;

        const result = {
            provider: 'twitch',
            docId,
            subscriptionId,
            eventType: expectedEventType
        };

        if (!subscriptionId) {
            result.error = 'missing_subscription_id';
            results.push(result);
            continue;
        }

        try {
            const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
            url.searchParams.set('id', subscriptionId);

            let response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${appToken}`,
                    'Client-Id': clientId
                }
            });

            if (response.status === 401) {
                console.warn('Twitch verification token expired, refreshing...');
                appToken = await twitchInitializer.getAppAccessToken();
                response = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${appToken}`,
                        'Client-Id': clientId
                    }
                });
            }

            if (!response.ok) {
                const text = await response.text();
                console.warn('Twitch verification failed', {
                    subscriptionId,
                    status: response.status,
                    body: text
                });
                result.error = 'twitch_request_failed';
                result.statusCode = response.status;
                result.details = safeParseJsonForSocialHooks(text);
                await markSubscriptionStatus(db, admin, userId, docId, {
                    isActive: false,
                    status: 'verification_failed',
                    lastVerificationError: typeof result.details === 'object' ? result.details?.message || null : result.details
                });
                results.push(result);
                continue;
            }

            const payload = await response.json();
            const subscription = Array.isArray(payload.data) && payload.data.length > 0 ? payload.data[0] : null;

            if (!subscription) {
                result.error = 'not_found';
                result.found = false;
                await markSubscriptionStatus(db, admin, userId, docId, {
                    isActive: false,
                    status: 'not_found'
                });
                results.push(result);
                continue;
            }

            result.subscription = subscription;
            result.status = subscription.status || null;
            result.found = true;

            const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
            const createdAt = subscription.created_at ? new Date(subscription.created_at) : null;

            const actualType = subscription.type || expectedEventType;
            const actualDocId = actualType ? `twitch_${actualType}` : docId;

            result.eventType = actualType;
            if (actualDocId !== docId) {
                result.mismatchedType = true;
                result.expectedEventType = expectedEventType;
                result.correctedDocId = actualDocId;
            }

            await markSubscriptionStatus(db, admin, userId, actualDocId, {
                provider: 'twitch',
                eventType: actualType,
                twitchSubscription: subscription,
                status: subscription.status || null,
                isActive: subscription.status === 'enabled',
                condition: subscription.condition || null,
                transport: subscription.transport || null,
                expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
                createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined
            });

            if (actualDocId !== docId && docId) {
                try {
                    await db.collection('users').doc(userId).collection('subscriptions').doc(docId).delete();
                    console.log('Removed outdated subscription document', docId, 'after type correction to', actualType);
                } catch (cleanupError) {
                    console.warn('Failed to remove outdated subscription doc', docId, cleanupError);
                }
            }
        } catch (err) {
            console.error('Error verifying Twitch subscription:', {
                subscriptionId,
                error: err
            });
            result.error = 'exception';
            result.message = err.message || 'Unknown error';
            await markSubscriptionStatus(db, admin, userId, docId, {
                isActive: false,
                status: 'verification_error',
                lastVerificationError: err.message || 'Unknown error'
            });
        }

        results.push(result);
    }

    return results;
}

async function markSubscriptionStatus(db, admin, userId, docId, updates = {}) {
    if (!docId) return;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const payload = { ...updates };

    if (!('updatedAt' in payload)) {
        payload.updatedAt = now;
    }
    if (!('lastVerifiedAt' in payload)) {
        payload.lastVerifiedAt = now;
    }

    if ('expiresAt' in payload && payload.expiresAt === undefined) {
        delete payload.expiresAt;
    }
    if ('createdAt' in payload && payload.createdAt === undefined) {
        delete payload.createdAt;
    }

    await db.collection('users')
        .doc(userId)
        .collection('subscriptions')
        .doc(docId)
        .set(payload, { merge: true });
}

function safeParseJsonForSocialHooks(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (err) {
        return text;
    }
}

/**
 * Create Stripe checkout session
 */
async function createCheckoutSession(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        const userEmail = decodedToken.email;

        // Parse request body
        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }

        const { tier, priceId, successUrl, cancelUrl } = body;

        if (!tier || !['standard', 'pro'].includes(tier)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid tier specified' })
            };
        }

        if (!priceId || !priceId.startsWith('price_')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid price ID provided' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Get or create Stripe customer
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        let stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: userEmail,
                metadata: {
                    firebaseUID: userId
                }
            });
            stripeCustomerId = customer.id;

            // Save customer ID to Firestore
            await db.collection('users').doc(userId).set({
                stripeCustomerId: stripeCustomerId
            }, { merge: true });
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                }
            ],
            mode: 'subscription',
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                firebaseUID: userId,
                tier: tier
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create checkout session',
                message: error.message 
            })
        };
    }
}

/**
 * Cancel subscription
 */
async function cancelSubscription(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Get user's subscription ID
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const stripeSubscriptionId = userDoc.data()?.stripeSubscriptionId;

        if (!stripeSubscriptionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No active subscription found' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Cancel subscription at period end
        const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        // Update Firestore
        await db.collection('users').doc(userId).update({
            cancelAtPeriodEnd: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update custom claims
        await admin.auth().setCustomUserClaims(userId, {
            ...decodedToken,
            cancelAtPeriodEnd: true
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Subscription canceled successfully',
                subscription: {
                    id: subscription.id,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    currentPeriodEnd: subscription.current_period_end
                }
            })
        };

    } catch (error) {
        console.error('Error canceling subscription:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to cancel subscription',
                message: error.message 
            })
        };
    }
}

/**
 * Create customer portal session
 */
async function createPortalSession(event) {
    try {
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Parse request body
        let body;
        if (typeof event.body === 'string') {
            let bodyString = event.body;
            if (event.isBase64Encoded) {
                bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(bodyString || '{}');
        } else {
            body = event.body || {};
        }

        const { returnUrl } = body;

        // Get user's Stripe customer ID
        const db = admin.firestore();
        const userDoc = await db.collection('users').doc(userId).get();
        const stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No Stripe customer found' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Create portal session
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl || event.headers.origin || 'https://masky.ai'
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating portal session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create portal session',
                message: error.message 
            })
        };
    }
}

/**
 * Handle Stripe webhooks
 */
async function handleStripeWebhook(event) {
    try {
        // Initialize Stripe
        const { stripe, webhookSecret } = await stripeInitializer.initialize();

        // Get the signature from headers
        const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
        
        if (!signature) {
            console.error('No Stripe signature found in headers');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No signature provided' })
            };
        }

        // Get raw body
        let rawBody = event.body;
        if (event.isBase64Encoded) {
            rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
        }

        // Verify webhook signature
        let stripeEvent;
        try {
            stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid signature' })
            };
        }

        console.log('Webhook event type:', stripeEvent.type);

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Handle different event types
        switch (stripeEvent.type) {
            case 'checkout.session.completed': {
                const session = stripeEvent.data.object;
                const userId = session.metadata.firebaseUID;
                const tier = session.metadata.tier;
                const customerId = session.customer;
                const subscriptionId = session.subscription;

                // Get the subscription details from Stripe to get current_period_end
                const { stripe } = await stripeInitializer.initialize();
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);

                // Update user data
                await db.collection('users').doc(userId).set({
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    subscriptionTier: tier,
                    subscriptionStatus: 'active',
                    currentPeriodEnd: subscription.current_period_end,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                // Update custom claims
                await admin.auth().setCustomUserClaims(userId, {
                    subscriptionTier: tier,
                    subscriptionStatus: 'active',
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId,
                    currentPeriodEnd: subscription.current_period_end,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end
                });

                console.log('Subscription created for user:', userId);
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = stripeEvent.data.object;
                const customerId = subscription.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Determine tier from subscription items
                    // Note: You can also add metadata to products in Stripe Dashboard
                    const priceId = subscription.items.data[0].price.id;
                    const productId = subscription.items.data[0].price.product;
                    
                    // Try to get tier from subscription metadata first, then fallback to product lookup
                    let tier = subscription.metadata?.tier || 'free';
                    
                    // If no metadata, try to determine from product
                    if (!subscription.metadata?.tier) {
                        // You can add logic here to map product IDs to tiers if needed
                        // For now, we'll keep the tier from the original subscription creation
                        const existingData = userDoc.data();
                        tier = existingData.subscriptionTier || 'free';
                    }

                    const updateData = {
                        subscriptionStatus: subscription.status,
                        subscriptionTier: tier,
                        currentPeriodEnd: subscription.current_period_end,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };

                    await db.collection('users').doc(userId).update(updateData);

                    // Update custom claims
                    await admin.auth().setCustomUserClaims(userId, {
                        subscriptionTier: tier,
                        subscriptionStatus: subscription.status,
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: subscription.id,
                        currentPeriodEnd: subscription.current_period_end,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end
                    });

                    console.log('Subscription updated for user:', userId);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = stripeEvent.data.object;
                const customerId = subscription.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Downgrade to free tier
                    await db.collection('users').doc(userId).update({
                        subscriptionStatus: 'canceled',
                        subscriptionTier: 'free',
                        stripeSubscriptionId: null,
                        cancelAtPeriodEnd: false,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Update custom claims
                    await admin.auth().setCustomUserClaims(userId, {
                        subscriptionTier: 'free',
                        subscriptionStatus: 'canceled',
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: null,
                        cancelAtPeriodEnd: false
                    });

                    console.log('Subscription canceled for user:', userId);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = stripeEvent.data.object;
                const customerId = invoice.customer;

                // Find user by customer ID
                const usersSnapshot = await db.collection('users')
                    .where('stripeCustomerId', '==', customerId)
                    .limit(1)
                    .get();

                if (!usersSnapshot.empty) {
                    const userDoc = usersSnapshot.docs[0];
                    const userId = userDoc.id;

                    // Mark payment as failed
                    await db.collection('users').doc(userId).update({
                        subscriptionStatus: 'past_due',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    console.log('Payment failed for user:', userId);
                }
                break;
            }

            default:
                console.log('Unhandled event type:', stripeEvent.type);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ received: true })
        };

    } catch (error) {
        console.error('Error handling webhook:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Webhook handler failed',
                message: error.message 
            })
        };
    }
}

/**
 * Handle voice file upload
 */
async function handleVoiceUpload(event) {
    try {
        console.log('Voice upload request received');
        
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Check content type
        const contentType = event.headers['Content-Type'] || event.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid content type - expected multipart/form-data' })
            };
        }

        // Extract boundary from content type
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid multipart boundary' })
            };
        }

        const boundary = boundaryMatch[1];
        
        // Get raw body
        let rawBody = event.body;
        if (event.isBase64Encoded) {
            rawBody = Buffer.from(event.body, 'base64');
        } else if (typeof event.body === 'string') {
            rawBody = Buffer.from(event.body, 'binary');
        } else {
            rawBody = Buffer.from(event.body);
        }

        // Parse multipart data
        const { files, fields } = parseMultipartData(rawBody.toString('binary'), boundary);
        
        if (!files || files.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No file provided in upload' })
            };
        }

        const uploadedFile = files[0];
        const name = fields.name || 'Voice Recording';
        const duration = parseInt(fields.duration) || 0;

        // Generate filename
        const timestamp = Date.now();
        const fileExtension = uploadedFile.fileName.split('.').pop() || 'wav';
        const sanitizedUserId = userId.replace(/[:/.]/g, '_');
        const basePath = `userData/${sanitizedUserId}/voices`;
        const fileName = `voice_${sanitizedUserId}_${timestamp}.${fileExtension}`;

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const objectPath = `${basePath}/${fileName}`;
        const file = bucket.file(objectPath);
        await file.save(uploadedFile.data, {
            metadata: {
                contentType: uploadedFile.contentType,
                metadata: {
                    userId: userId,
                    originalFileName: uploadedFile.fileName,
                    uploadedAt: new Date().toISOString()
                }
            }
        });

        // Make file publicly accessible
        await file.makePublic();

        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

        // Save voice metadata to Firestore
        const db = admin.firestore();
        const voiceData = {
            name: name,
            url: publicUrl,
            duration: duration,
            userId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        const voiceDoc = await db.collection('users').doc(userId).collection('voices').add(voiceData);

        console.log('Voice uploaded successfully:', voiceDoc.id);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                voiceId: voiceDoc.id,
                voiceUrl: publicUrl,
                name: name,
                duration: duration
            })
        };

    } catch (error) {
        console.error('Error uploading voice:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to upload voice',
                message: error.message 
            })
        };
    }
}

/**
 * Handle avatar image upload
 */
async function handleAvatarUpload(event) {
    try {
        console.log('Avatar upload request received');
        
        // Verify Firebase token
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized - No token provided' })
            };
        }

        const idToken = authHeader.split('Bearer ')[1];
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        // Check content type
        const contentType = event.headers['Content-Type'] || event.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid content type - expected multipart/form-data' })
            };
        }

        // Extract boundary from content type
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid multipart boundary' })
            };
        }

        const boundary = boundaryMatch[1];
        
        // Get raw body
        let rawBody = event.body;
        if (event.isBase64Encoded) {
            rawBody = Buffer.from(event.body, 'base64');
        } else if (typeof event.body === 'string') {
            rawBody = Buffer.from(event.body, 'binary');
        } else {
            rawBody = Buffer.from(event.body);
        }

        // Parse multipart data
        const { files, fields } = parseMultipartData(rawBody.toString('binary'), boundary);
        
        if (!files || files.length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No file provided in upload' })
            };
        }

        const uploadedFile = files[0];

        // Generate filename
        const timestamp = Date.now();
        const fileExtension = uploadedFile.fileName.split('.').pop() || 'jpg';
        const sanitizedUserId = userId.replace(/[:/.]/g, '_');
        const basePath = `userData/${sanitizedUserId}/avatars`;
        const fileName = `avatar_${sanitizedUserId}_${timestamp}.${fileExtension}`;

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const objectPath = `${basePath}/${fileName}`;
        const file = bucket.file(objectPath);
        await file.save(uploadedFile.data, {
            metadata: {
                contentType: uploadedFile.contentType,
                metadata: {
                    userId: userId,
                    originalFileName: uploadedFile.fileName,
                    uploadedAt: new Date().toISOString()
                }
            }
        });

        // Make file publicly accessible
        await file.makePublic();

        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;

        console.log('Avatar uploaded successfully:', publicUrl);

        // Save avatar metadata to Firestore under user's avatars subcollection
        const db = admin.firestore();
        const avatarData = {
            url: publicUrl,
            fileName: uploadedFile.fileName,
            userId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const avatarDoc = await db.collection('users').doc(userId).collection('avatars').add(avatarData);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                avatarUrl: publicUrl,
                avatarId: avatarDoc.id
            })
        };

    } catch (error) {
        console.error('Error uploading avatar:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to upload avatar',
                message: error.message 
            })
        };
    }
}

/**
 * Debug function to test Stripe connection and list subscriptions
 */
async function debugStripeConnection(event) {
    try {
        console.log('Debug: Testing Stripe connection');
        
        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();
        
        // List recent subscriptions to see what's available
        const subscriptions = await stripe.subscriptions.list({
            limit: 10,
            expand: ['data.latest_invoice', 'data.customer']
        });
        
        console.log('Debug: Found subscriptions:', subscriptions.data.length);
        
        const debugInfo = {
            stripeConnected: true,
            subscriptionCount: subscriptions.data.length,
            subscriptions: subscriptions.data.map(sub => ({
                id: sub.id,
                status: sub.status,
                current_period_end: sub.current_period_end,
                current_period_start: sub.current_period_start,
                cancel_at_period_end: sub.cancel_at_period_end,
                customer: sub.customer,
                created: sub.created
            }))
        };
        
        return {
            statusCode: 200,
            body: JSON.stringify(debugInfo)
        };
        
    } catch (error) {
        console.error('Debug: Stripe connection error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Stripe connection failed',
                message: error.message,
                stripeConnected: false
            })
        };
    }
}

    