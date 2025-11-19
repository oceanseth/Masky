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
                // Create new user - only include email if it's defined
                const createUserData = {
                    uid: uid,
                    displayName: twitchUser.display_name || null,
                    photoURL: twitchUser.profile_image_url || null
                };
                if (twitchUser.email) {
                    createUserData.email = twitchUser.email;
                }
                userRecord = await admin.auth().createUser(createUserData);
            } else {
                throw error;
            }
        }

        // Store user data in Firestore (including Twitch username for URL lookup)
        // Only include fields that are defined (Firestore doesn't allow undefined values)
        const db = admin.firestore();
        const userDocRef = db.collection('users').doc(uid);
        const userData = {
            twitchId: twitchUser.id,
            displayName: twitchUser.display_name || null,
            photoURL: twitchUser.profile_image_url || null,
            twitchUsername: (twitchUser.login || twitchUser.display_name?.toLowerCase() || null), // Store lowercase username
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        // Only include email if it's defined
        if (twitchUser.email) {
            userData.email = twitchUser.email;
        }
        await userDocRef.set(userData, { merge: true });

        await twitchInitializer.storeAdminSession(admin, {
            uid,
            twitchUser,
            accessToken,
            refreshToken: null,
            expiresIn: null,
            scope: [],
            context: 'login'
        });

        const existingClaims = userRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(uid, {
            ...existingClaims,
            provider: 'twitch',
            twitchId: twitchUser.id,
            displayName: twitchUser.display_name,
            profileImage: twitchUser.profile_image_url,
            twitchAccessToken: accessToken
        });

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
                    displayName: twitchUser.display_name || null,
                    photoURL: twitchUser.profile_image_url || null,
                    email: twitchUser.email || null,
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

const handleAdminImpersonate = async (event) => {
    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized: missing bearer token' })
            };
        }

        const idToken = authHeader.split(' ')[1];

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

        const { targetUid } = body;
        if (!targetUid || typeof targetUid !== 'string') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'targetUid is required' })
            };
        }

        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(idToken);
        const requesterUid = decoded.uid;

        const db = admin.firestore();
        const adminDocRef = db.collection('system').doc('adminData');
        const adminDoc = await adminDocRef.get();

        if (!adminDoc.exists) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'Admin configuration not found' })
            };
        }

        const adminUsers = Array.isArray(adminDoc.data().adminUsers) ? adminDoc.data().adminUsers : [];
        if (!adminUsers.includes(requesterUid)) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'Forbidden: user is not an admin' })
            };
        }

        const tokenDocRef = adminDocRef.collection('userTokens').doc(targetUid);
        const tokenDoc = await tokenDocRef.get();
        if (!tokenDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User session data not found' })
            };
        }

        const tokenData = tokenDoc.data();
        let accessToken = tokenData.accessToken;
        let refreshToken = tokenData.refreshToken || null;
        const scopesFromDoc = Array.isArray(tokenData.scopes) ? tokenData.scopes : [];
        const storedExpiresAt = tokenData.expiresAt && typeof tokenData.expiresAt.toDate === 'function'
            ? tokenData.expiresAt.toDate()
            : (tokenData.expiresAt ? new Date(tokenData.expiresAt) : null);

        let tokenValid = false;
        if (accessToken) {
            try {
                await twitchInitializer.validateToken(accessToken);
                tokenValid = true;
            } catch (validationError) {
                console.warn('Stored Twitch token validation failed, attempting refresh if possible:', validationError.message);
            }
        }

        let refreshed = false;
        let refreshResponseData = null;
        if (!tokenValid && refreshToken) {
            const { clientId, clientSecret } = await twitchInitializer.initialize();
            const refreshParams = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            });

            const refreshResponse = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: refreshParams.toString()
            });

            if (!refreshResponse.ok) {
                const errorText = await refreshResponse.text().catch(() => '');
                console.error('Failed to refresh Twitch token:', refreshResponse.status, errorText);
                return {
                    statusCode: 502,
                    body: JSON.stringify({
                        error: 'Failed to refresh Twitch token',
                        status: refreshResponse.status,
                        message: errorText || 'Unknown Twitch refresh error'
                    })
                };
            }

            refreshResponseData = await refreshResponse.json();
            if (!refreshResponseData.access_token) {
                console.error('Twitch refresh response missing access token:', refreshResponseData);
                return {
                    statusCode: 502,
                    body: JSON.stringify({ error: 'Invalid Twitch refresh response' })
                };
            }

            accessToken = refreshResponseData.access_token;
            refreshToken = refreshResponseData.refresh_token || refreshToken;
            tokenValid = true;
            refreshed = true;
        }

        if (!tokenValid) {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: 'User Twitch token is invalid and cannot be refreshed. Ask the user to log in again.'
                })
            };
        }

        const targetUserRecord = await admin.auth().getUser(targetUid);

        const twitchId = tokenData.twitchId
            || (targetUid.startsWith('twitch:') ? targetUid.split(':')[1] : null);

        const displayName = targetUserRecord.displayName || tokenData.displayName || null;
        const photoURL = targetUserRecord.photoURL || tokenData.photoURL || null;
        const email = targetUserRecord.email || tokenData.email || null;

        let expiresAtDate = null;
        if (refreshed && refreshResponseData?.expires_in) {
            expiresAtDate = new Date(Date.now() + (refreshResponseData.expires_in * 1000));
        } else if (storedExpiresAt instanceof Date && !Number.isNaN(storedExpiresAt.getTime())) {
            expiresAtDate = storedExpiresAt;
        }

        const refreshedScopes = refreshed
            ? (Array.isArray(refreshResponseData?.scope)
                ? refreshResponseData.scope
                : (typeof refreshResponseData?.scope === 'string'
                    ? refreshResponseData.scope.split(' ').map(scope => scope.trim()).filter(Boolean)
                    : []))
            : [];
        const scopesToPersist = refreshed
            ? (refreshedScopes.length > 0 ? refreshedScopes : scopesFromDoc)
            : scopesFromDoc;

        const secondsUntilExpiry = expiresAtDate
            ? Math.max(0, Math.floor((expiresAtDate.getTime() - Date.now()) / 1000))
            : null;

        await twitchInitializer.storeAdminSession(admin, {
            uid: targetUid,
            twitchUser: {
                id: twitchId,
                display_name: displayName,
                profile_image_url: photoURL,
                email
            },
            accessToken,
            refreshToken,
            expiresIn: secondsUntilExpiry,
            scope: scopesToPersist,
            context: 'impersonation'
        });

        const existingClaims = targetUserRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(targetUid, {
            ...existingClaims,
            provider: 'twitch',
            twitchId,
            displayName,
            profileImage: photoURL,
            twitchAccessToken: accessToken
        });

        const customToken = await admin.auth().createCustomToken(targetUid, {
            provider: 'twitch',
            twitchId,
            displayName,
            profileImage: photoURL,
            twitchAccessToken: accessToken,
            impersonatedBy: requesterUid,
            impersonatedAt: new Date().toISOString()
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                firebaseToken: customToken,
                target: {
                    uid: targetUid,
                    displayName,
                    photoURL,
                    email,
                    twitchId
                },
                refreshed,
                expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null,
                scopes: scopesToPersist
            })
        };
    } catch (error) {
        console.error('Admin impersonation error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to impersonate user',
                message: error.message
            })
        };
    }
};

/**
 * Determine the API base URL based on the request headers and URL
 * Used for OAuth redirect URIs and other API endpoints
 */
function getApiBaseUrl(event) {
    // Check request URL first (for direct redirects from Twitch)
    const requestUrl = event.requestContext?.domainName || '';
    if (requestUrl && (requestUrl.includes('localhost') || requestUrl.includes('127.0.0.1'))) {
        return 'http://localhost:3001';
    }
    
    // Check for local development indicators in headers
    const origin = event.headers?.origin || event.headers?.Origin || '';
    const referer = event.headers?.referer || event.headers?.Referer || '';
    const host = event.headers?.host || event.headers?.Host || '';
    
    // Check if request is from localhost
    const isLocalhost = origin.includes('localhost') || 
                       origin.includes('127.0.0.1') ||
                       referer.includes('localhost') ||
                       referer.includes('127.0.0.1') ||
                       host.includes('localhost') ||
                       host.includes('127.0.0.1') ||
                       host === 'localhost:3001' ||
                       host === '127.0.0.1:3001';
    
    if (isLocalhost) {
        return 'http://localhost:3001';
    }
    
    // Production default
    return 'https://masky.ai';
}

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
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With,Cache-Control,Accept,Origin',
        'Access-Control-Allow-Credentials': requestOrigin !== '*' ? 'true' : 'false',
        'Access-Control-Max-Age': '86400'
    };
    
    // Get API base URL for this request
    const apiBaseUrl = getApiBaseUrl(event);

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

    if (path.includes('/admin/impersonate') && method === 'POST') {
        const response = await handleAdminImpersonate(event);
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

    // Get fresh video URL for a project
    if (path.includes('/projects/') && path.includes('/video-url') && method === 'GET') {
        try {
            // Extract projectId from path (e.g., /projects/{projectId}/video-url)
            const pathMatch = path.match(/\/projects\/([^\/]+)\/video-url/);
            const projectId = pathMatch?.[1] || event.queryStringParameters?.projectId;
            
            if (!projectId) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Missing projectId' })
                };
            }

            await firebaseInitializer.initialize();
            const admin = require('firebase-admin');
            const db = admin.firestore();

            // Get project from Firestore
            const projectDoc = await db.collection('projects').doc(projectId).get();
            if (!projectDoc.exists) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Project not found' })
                };
            }

            const projectData = projectDoc.data();
            
            // Check if it's an uploaded video (has videoUrl in Firestore)
            if (projectData.videoUrl && projectData.projectType === 'upload') {
                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        videoUrl: projectData.videoUrl,
                        type: 'uploaded',
                        expiresAt: null
                    })
                };
            }

            // For HeyGen videos, check if we have a persisted videoUrl (for completed videos)
            const heygenVideoId = projectData.heygenVideoId;
            if (!heygenVideoId) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'No video found for this project' })
                };
            }
            
            // Check for force refresh parameter
            const url = new URL(event.rawUrl || `${event.headers.origin || 'http://localhost:3001'}${path}${event.rawQueryString ? ('?' + event.rawQueryString) : ''}`);
            const forceRefresh = url.searchParams.get('refresh') === 'true' || event.queryStringParameters?.refresh === 'true';
            
            // Helper to check if URL is a signed/expiring URL
            const isSignedUrl = (url) => {
                if (!url) return false;
                try {
                    const urlObj = new URL(url);
                    return urlObj.searchParams.has('Expires') || urlObj.searchParams.has('Signature') || urlObj.searchParams.has('Key-Pair-Id');
                } catch {
                    return url.includes('Expires=') || url.includes('Signature=') || url.includes('Key-Pair-Id=');
                }
            };
            
            // If HeyGen video is completed and has a persisted videoUrl, check if we should use it
            // Only use persisted URL if it's NOT a signed URL (signed URLs expire and need fresh fetch)
            // OR if force refresh is requested, always fetch fresh
            if (!forceRefresh && projectData.videoUrl && projectData.heygenVideoReady && !isSignedUrl(projectData.videoUrl)) {
                // Persisted direct URL (not signed) - safe to return
                return {
                    statusCode: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        videoUrl: projectData.videoUrl,
                        type: 'heygen',
                        expiresAt: null,
                        status: projectData.heygenStatus || projectData.heygenLastStatus || 'completed',
                        cached: false // Not cached, but persisted
                    })
                };
            }
            
            // If we have a persisted signed URL but force refresh or it might be expired, fetch fresh
            // (Signed URLs should always be fetched fresh from HeyGen)

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

            const parseExpiryTimestamp = (value) => {
                if (!value) return null;
                const normalized = normalizeExpiry(value);
                if (!normalized) return null;
                const parsed = new Date(normalized);
                return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
            };

            // Check if we have a cached URL that's still valid (with 15 minute buffer)
            const cachedUrl = projectData.heygenVideoUrl || null;
            const cachedExpiry = projectData.heygenVideoUrlExpiresAt || null;
            const expiryBufferMs = 15 * 60 * 1000; // 15 minutes
            const now = Date.now();

            if (cachedUrl && cachedExpiry) {
                const expiryTimestamp = parseExpiryTimestamp(cachedExpiry);
                if (expiryTimestamp && expiryTimestamp - expiryBufferMs > now) {
                    // Cached URL is still valid, return it
                    return {
                        statusCode: 200,
                        headers: {
                            ...headers,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            videoUrl: cachedUrl,
                            type: 'heygen',
                            expiresAt: normalizeExpiry(cachedExpiry),
                            status: projectData.heygenStatus || projectData.heygenLastStatus || null,
                            cached: true
                        })
                    };
                }
            }

            // Fetch fresh URL from HeyGen
            const payload = await heygen.getVideoStatus(heygenVideoId);
            const data = payload?.data || payload || {};
            const signedUrl = data.video_signed_url?.url || null;
            const signedExpiry = data.video_signed_url?.expired_time || data.video_signed_url?.expire_time || null;
            const directUrl = data.video_url || data.videoUrl || null;
            const resolvedUrl = signedUrl || directUrl || null;

            if (!resolvedUrl) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Video URL not available',
                        status: data.status || payload?.status || 'unknown'
                    })
                };
            }

            const normalizedExpiry = normalizeExpiry(signedExpiry || data.expire_time || data.expired_time || data.expiredTime || null);
            const videoStatus = data.status || payload?.status || null;

            // Save the fresh URL to Firestore for future use
            const projectRef = db.collection('projects').doc(projectId);
            const updateData = {
                heygenVideoUrl: resolvedUrl,
                heygenVideoUrlExpiresAt: normalizedExpiry,
                heygenLastStatus: videoStatus,
                heygenLastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            // Only update videoUrl if status is completed AND it's not a signed URL
            // (Signed URLs expire, so we shouldn't persist them - always fetch fresh)
            if (videoStatus === 'completed') {
                updateData.heygenVideoReady = true;
                // Only persist direct URLs (not signed URLs) to videoUrl
                // Signed URLs should always be fetched fresh from HeyGen
                if (!isSignedUrl(resolvedUrl)) {
                    updateData.videoUrl = resolvedUrl; // Persist direct URL for fast loading on refresh
                } else {
                    // If it's a signed URL, clear any existing persisted videoUrl
                    // (We'll always fetch fresh signed URLs)
                    updateData.videoUrl = admin.firestore.FieldValue.delete();
                }
            }
            
            await projectRef.update(updateData).catch(err => {
                console.warn('Failed to save fresh video URL to Firestore:', err);
                // Don't fail the request if saving fails
            });

            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    videoUrl: resolvedUrl,
                    type: 'heygen',
                    expiresAt: normalizedExpiry,
                    status: videoStatus,
                    cached: false
                })
            };
        } catch (err) {
            console.error('Failed to get fresh video URL for project:', err);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to get video URL', message: err.message })
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
                    isMuted: Boolean(data.isMuted),
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
                        lastCheckedAt: nowIso,
                        muted: Boolean(data.isMuted)
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
                    const projectId = projectRecord.projectId;
                    
                    try {
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

                        const parseExpiryTimestamp = (value) => {
                            if (!value) return null;
                            const normalized = normalizeExpiry(value);
                            if (!normalized) return null;
                            const parsed = new Date(normalized);
                            return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
                        };

                        // Check if we have a cached URL that's still valid (with 15 minute buffer)
                        const projectDoc = await db.collection('projects').doc(projectId).get();
                        const projectData = projectDoc.exists ? projectDoc.data() : {};
                        const cachedUrl = projectData.heygenVideoUrl || null;
                        const cachedExpiry = projectData.heygenVideoUrlExpiresAt || null;
                        const expiryBufferMs = 15 * 60 * 1000; // 15 minutes
                        const now = Date.now();
                        let resolvedUrl = null;
                        let normalizedExpiry = null;
                        let status = lastKnownStatus || null;

                        if (cachedUrl && cachedExpiry) {
                            const expiryTimestamp = parseExpiryTimestamp(cachedExpiry);
                            if (expiryTimestamp && expiryTimestamp - expiryBufferMs > now) {
                                // Use cached URL
                                resolvedUrl = cachedUrl;
                                normalizedExpiry = normalizeExpiry(cachedExpiry);
                                status = projectData.heygenStatus || projectData.heygenLastStatus || status;
                            }
                        }

                        // If no valid cached URL, fetch fresh one
                        if (!resolvedUrl) {
                            const payload = await heygen.getVideoStatus(videoId);
                            const data = payload?.data || payload || {};
                            const signedUrl = data.video_signed_url?.url || null;
                            const signedExpiry = data.video_signed_url?.expired_time || data.video_signed_url?.expire_time || null;
                            const directUrl = data.video_url || data.videoUrl || null;
                            resolvedUrl = signedUrl || directUrl || null;
                            status = data.status || payload?.status || lastKnownStatus || null;
                            normalizedExpiry = normalizeExpiry(signedExpiry || data.expire_time || data.expired_time || data.expiredTime || null);

                            // Save the fresh URL to Firestore for future use
                            if (resolvedUrl && projectDoc.exists) {
                                const projectRef = db.collection('projects').doc(projectId);
                                const updateData = {
                                    heygenVideoUrl: resolvedUrl,
                                    heygenVideoUrlExpiresAt: normalizedExpiry,
                                    heygenLastStatus: status,
                                    heygenLastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                                };
                                
                                // Only update videoUrl if status is completed AND it's not a signed URL
                                // (Signed URLs expire, so we shouldn't persist them - always fetch fresh)
                                if (status === 'completed') {
                                    updateData.heygenVideoReady = true;
                                    // Only persist direct URLs (not signed URLs) to videoUrl
                                    // Signed URLs should always be fetched fresh from HeyGen
                                    const isSigned = (url) => {
                                        if (!url) return false;
                                        try {
                                            const urlObj = new URL(url);
                                            return urlObj.searchParams.has('Expires') || urlObj.searchParams.has('Signature') || urlObj.searchParams.has('Key-Pair-Id');
                                        } catch {
                                            return url.includes('Expires=') || url.includes('Signature=') || url.includes('Key-Pair-Id=');
                                        }
                                    };
                                    if (!isSigned(resolvedUrl)) {
                                        updateData.videoUrl = resolvedUrl; // Persist direct URL for fast loading on refresh
                                    } else {
                                        // If it's a signed URL, clear any existing persisted videoUrl
                                        // (We'll always fetch fresh signed URLs)
                                        updateData.videoUrl = admin.firestore.FieldValue.delete();
                                    }
                                }
                                
                                await projectRef.update(updateData).catch(err => {
                                    console.warn(`Failed to save fresh video URL to Firestore for project ${projectId}:`, err);
                                    // Don't fail the request if saving fails
                                });
                            }
                        }

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
                            muted: false,
                            expiresAt: normalizedExpiry,
                            raw: {
                                video_url: resolvedUrl ? (data?.video_url || null) : null,
                                video_signed_url: resolvedUrl ? (data?.video_signed_url || null) : null
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
                            muted: false,
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
                // Get API base URL for redirect URI
                const apiBaseUrl = getApiBaseUrl(event);
                const redirectUri = `${apiBaseUrl}/api/twitch_oauth`;
                
                const callbackEvent = {
                    ...event,
                    httpMethod: 'POST',
                    body: JSON.stringify({
                        code,
                        // Use the appropriate API endpoint as redirect URI (localhost or production)
                        redirectUri: redirectUri
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
                
                // Log the response for debugging
                console.log('OAuth callback response:', {
                    statusCode: response?.statusCode,
                    hasBody: !!response?.body,
                    bodyPreview: response?.body ? (typeof response.body === 'string' ? response.body.substring(0, 200) : JSON.stringify(response.body).substring(0, 200)) : 'none'
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
                let errorDetails = null;
                try {
                    if (response.body) {
                        errorDetails = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
                    }
                } catch (e) {
                    errorDetails = { rawBody: response.body };
                }
                debugInfo.innerHTML = '<h4>Debug Information</h4><pre>' + JSON.stringify({
                    statusCode: response.statusCode,
                    hasOpener: !!window.opener,
                    currentOrigin: window.location.origin,
                    responseKeys: Object.keys(response),
                    errorDetails: errorDetails
                }, null, 2) + '</pre>';
                
                if (response.statusCode === 200) {
                    // Success - send message to parent and close popup
                    console.log('Processing successful OAuth response:', response);
                    
                    const userData = response.body ? JSON.parse(response.body) : null;
                    const message = {
                        type: 'TWITCH_OAUTH_SUCCESS',
                        user: userData
                    };
                    
                    // Try to send message to opener
                    if (window.opener && !window.opener.closed) {
                        try {
                            console.log('Sending success message to parent:', message);
                            console.log('Target origin:', window.location.origin);
                            console.log('Window opener exists:', !!window.opener);
                            
                            // Use '*' to allow any origin - security is handled by checking event.origin in the receiver
                            window.opener.postMessage(message, '*');
                            console.log('Success message sent to parent');
                            
                            // Close popup after short delay
                            setTimeout(() => {
                                console.log('Closing popup window');
                                if (!window.opener || window.opener.closed) {
                                    window.close();
                                } else {
                                    window.close();
                                }
                            }, 2000);
                        } catch (e) {
                            console.error('Error sending success message:', e);
                            // Still try to close after delay
                            setTimeout(() => {
                                window.close();
                            }, 5000);
                        }
                    } else {
                        console.warn('No window.opener found or opener closed - trying to communicate via localStorage as fallback');
                        
                        // Fallback: Use localStorage to communicate if opener is not available
                        try {
                            const eventKey = 'twitch_oauth_success_' + Date.now();
                            localStorage.setItem(eventKey, JSON.stringify(message));
                            
                            // Dispatch storage event for same-origin listeners
                            window.dispatchEvent(new StorageEvent('storage', {
                                key: eventKey,
                                newValue: JSON.stringify(message)
                            }));
                            
                            console.log('Stored success message in localStorage as fallback');
                        } catch (e) {
                            console.error('Could not use localStorage fallback:', e);
                        }
                        
                        // Give user time to see the success message
                        setTimeout(() => {
                            window.close();
                        }, 3000);
                    }
                    
                    document.getElementById('status').innerHTML = '<div class="success">✓ Authentication successful! ' + 
                        (window.opener && !window.opener.closed ? 'Closing window...' : 'You can close this window.') + 
                        '</div>';
                } else {
                    // Error - send error message to parent
                    let errorData = { error: 'Unknown error' };
                    try {
                        errorData = response.body ? (typeof response.body === 'string' ? JSON.parse(response.body) : response.body) : { error: 'Unknown error' };
                    } catch (e) {
                        console.error('Failed to parse error response body:', e);
                        errorData = { error: 'Failed to parse error response', rawBody: response.body };
                    }
                    
                    const errorMessage = errorData.message || errorData.error || 'Authentication failed';
                    console.error('OAuth error:', errorData);
                    
                    if (window.opener) {
                        try {
                            // Use '*' to allow any origin - security is handled by checking event.origin in the receiver
                            window.opener.postMessage({
                                type: 'TWITCH_OAUTH_ERROR',
                                error: errorMessage,
                                details: errorData
                            }, '*');
                            console.log('Error message sent to parent:', errorMessage);
                        } catch (e) {
                            console.error('Error sending error message:', e);
                        }
                    }
                    document.getElementById('status').innerHTML = '<div class="error">✗ Authentication failed: ' + errorMessage + (errorData.details ? '<br><small>' + errorData.details + '</small>' : '') + '</div>';
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

    // Create donation checkout session
    if (path.includes('/donations/create') && method === 'POST') {
        const response = await createDonationCheckoutSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Create custom video checkout session
    if (path.includes('/custom-videos/create-checkout') && method === 'POST') {
        const response = await createCustomVideoCheckoutSession(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Create custom video (after payment or with credits)
    if (path.includes('/custom-videos/create') && method === 'POST') {
        const response = await createCustomVideo(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Redemptions endpoint
    if (path.includes('/redemptions/redeem') && method === 'POST') {
        const response = await redeemPoints(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Refund redemption endpoint
    if (path.includes('/redemptions/refund') && method === 'POST') {
        const response = await refundRedemption(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
    }

    // Join tribe
    if (path.includes('/tribe/join') && method === 'POST') {
        const response = await joinTribe(event);
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
                        // Normalize scopes to array (might be stored as string or array)
                        const scopes = Array.isArray(botTokens.scopes) ? botTokens.scopes : 
                                      (typeof botTokens.scopes === 'string' ? botTokens.scopes.split(' ').filter(Boolean) : []);
                        
                        const hasUserReadChat = scopes.includes('user:read:chat') || 
                                               scopes.includes('chat:read');
                        
                        console.log('Checking bot authorization:', {
                            hasAccessToken: !!botTokens.accessToken,
                            scopes: scopes,
                            hasUserReadChat,
                            botTwitchId: botTokens.twitchId
                        });
                        
                        // For EventSub channel.chat.message, the bot account only needs user:read:chat
                        // The user:bot scope is not required and may not be available through standard OAuth
                        if (hasUserReadChat) {
                            botHasAuthorized = true;
                            console.log('Bot account has authorized with required scopes:', scopes);
                        } else {
                            console.log('Bot account authorized but missing required scopes:', {
                                hasUserReadChat,
                                scopes: scopes,
                                rawScopes: botTokens.scopes
                            });
                        }
                    } else {
                        console.log('Bot tokens exist but missing accessToken or scopes:', {
                            hasAccessToken: !!botTokens.accessToken,
                            hasScopes: !!botTokens.scopes
                        });
                    }
                } else {
                    console.log('Bot tokens document does not exist in Firestore');
                }
                
                // Generate bot authorization URL if not authorized
                if (!botHasAuthorized) {
                    // Get API base URL for redirect URI
                    const apiBaseUrl = getApiBaseUrl(event);
                    const redirectUri = `${apiBaseUrl}/api/twitch_oauth`;
                    // Only request user:read:chat - user:bot is not a valid scope or not needed
                    botAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('user:read:chat')}`;
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
                    note: 'Bot account must have authorized this app with user:read:chat scope'
                });
                
                const requestBody = {
                    type: 'channel.chat.message',
                    version: '1',
                    condition: {
                        broadcaster_user_id: twitchId, // The broadcaster's channel
                        user_id: botUserId // Bot account ID - must have authorized with user:read:chat
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
                            message: 'The bot account (maskyai) must authorize the app with user:read:chat scope before creating chat subscriptions.',
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
                                // Get API base URL for redirect URI
                                const apiBaseUrl = getApiBaseUrl(event);
                                const redirectUri = `${apiBaseUrl}/api/twitch_oauth`;
                                botAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('user:read:chat user:bot')}`;
                            }
                        }
                        
                        const error = new Error(errorMessage);
                        error.twitchPayload = twitchPayload;
                        error.twitchResponse = errorData;
                        error.twitchStatus = twitchResponse.status;
                        if (!error.botAuthUrl) {
                            // Get API base URL for redirect URI
                            const apiBaseUrl = getApiBaseUrl(event);
                            const redirectUri = `${apiBaseUrl}/api/twitch_oauth`;
                            error.botAuthUrl = botAuthUrl || `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('user:read:chat')}`;
                        }
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
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();
        const userRec = userSnap.exists ? userSnap.data() : {};
        let folderId = userRec.heygenFolderId || null;
        let folderRecord = null;
        try {
            folderRecord = await heygen.ensureUserFolder(userId, {
                parentFolderId: heygen.MASKY_ROOT_FOLDER_ID,
                existingFolderId: folderId,
                refresh: !folderId
            });
            folderId = folderRecord?.id || folderId;
        } catch (folderErr) {
            console.warn('Failed to ensure HeyGen folder; proceeding without folder:', folderErr.message);
        }

        if (folderId && folderRecord) {
            const normalizedName = folderRecord.name || userId;
            const normalizedParentId = folderRecord.parentId || heygen.MASKY_ROOT_FOLDER_ID;
            const needsUpdate =
                userRec.heygenFolderId !== folderId ||
                userRec.heygenFolderName !== normalizedName ||
                userRec.heygenFolderParentId !== normalizedParentId;

            if (needsUpdate) {
                const folderUpdate = {
                    heygenFolderId: folderId,
                    heygenFolderName: normalizedName,
                    heygenFolderParentId: normalizedParentId,
                    heygenFolderLastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };
                await userRef.set(folderUpdate, { merge: true });
            }
        } else if (folderId && !folderRecord) {
            const normalizedName = userRec.heygenFolderName || userId;
            const normalizedParentId = userRec.heygenFolderParentId || heygen.MASKY_ROOT_FOLDER_ID;
            const needsUpdate =
                userRec.heygenFolderId !== folderId ||
                userRec.heygenFolderName !== normalizedName ||
                userRec.heygenFolderParentId !== normalizedParentId;

            if (needsUpdate) {
                await userRef.set({
                    heygenFolderId: folderId,
                    heygenFolderName: normalizedName,
                    heygenFolderParentId: normalizedParentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
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
            planMaxDimension,
            folderId
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
 * Map Stripe price ID to subscription tier
 * @param {string} priceId - Stripe price ID
 * @returns {string} Subscription tier (free, viewer, creator, proCreator)
 */
function getTierFromPriceId(priceId) {
    // Price ID to tier mapping
    // This must match the prices in src/config.js
    const priceToTierMap = {
        'price_1STApoJwtIxwToTZBmaMkfIm': 'viewer',      // Viewer tier
        'price_1SQyPfJwtIxwToTZ7hgQGdRF': 'creator',     // Creator tier
        'price_1SQyR0JwtIxwToTZCbDhQUu7': 'proCreator'   // Pro Creator tier
    };
    
    return priceToTierMap[priceId] || 'free';
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

        // Always try to fetch latest data from Stripe if we have customer ID or subscription ID
        let stripeSubscription = null;
        const { stripe } = await stripeInitializer.initialize();

        // First, try to fetch by subscription ID if we have it
        if (subscription.stripeSubscriptionId) {
            try {
                console.log('Fetching subscription details from Stripe for ID:', subscription.stripeSubscriptionId);
                stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
                    expand: ['latest_invoice', 'customer', 'default_payment_method']
                });
                console.log('Found subscription by ID:', stripeSubscription.id);
            } catch (error) {
                console.error('Error fetching subscription by ID:', error.message);
                // Continue to try fetching by customer ID
                stripeSubscription = null;
            }
        }

        // If we don't have a subscription yet but have a customer ID, query Stripe by customer ID
        if (!stripeSubscription && subscription.stripeCustomerId) {
            try {
                console.log('No subscription ID found, querying Stripe by customer ID:', subscription.stripeCustomerId);
                const subscriptions = await stripe.subscriptions.list({
                    customer: subscription.stripeCustomerId,
                    status: 'all', // Get all statuses, we'll filter for active ones
                    limit: 10,
                    expand: ['data.latest_invoice', 'data.customer', 'data.default_payment_method']
                });

                console.log('Found', subscriptions.data.length, 'subscriptions for customer');

                // Find the most recent active or trialing subscription
                const activeSubscriptions = subscriptions.data.filter(sub => 
                    sub.status === 'active' || sub.status === 'trialing'
                );

                if (activeSubscriptions.length > 0) {
                    // Sort by created date (most recent first) and take the first one
                    activeSubscriptions.sort((a, b) => b.created - a.created);
                    stripeSubscription = activeSubscriptions[0];
                    console.log('Found active subscription:', stripeSubscription.id, 'status:', stripeSubscription.status);
                } else if (subscriptions.data.length > 0) {
                    // If no active subscriptions, use the most recent one anyway
                    subscriptions.data.sort((a, b) => b.created - a.created);
                    stripeSubscription = subscriptions.data[0];
                    console.log('No active subscriptions, using most recent:', stripeSubscription.id, 'status:', stripeSubscription.status);
                }
            } catch (error) {
                console.error('Error fetching subscriptions by customer ID:', error.message);
            }
        }

        // Process the subscription data if we found one
        if (stripeSubscription) {
            try {
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
                
                // Get the tier from the subscription's price ID
                // Check subscription items to get the current price ID
                let tierFromPriceId = null;
                if (stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data.length > 0) {
                    const priceId = stripeSubscription.items.data[0].price.id;
                    console.log('Found price ID in subscription:', priceId);
                    
                    // Map price ID to tier
                    tierFromPriceId = getTierFromPriceId(priceId);
                    console.log('Mapped tier from price ID:', tierFromPriceId);
                    
                    // Update subscription tier with the tier from price ID
                    subscription.tier = tierFromPriceId;
                } else {
                    console.log('No subscription items found, keeping existing tier');
                }
                
                console.log('Final currentPeriodEnd value:', subscription.currentPeriodEnd);
                console.log('Final subscription tier:', subscription.tier);

                // Update the data in Firebase for future requests (only if we have valid data)
                const updateData = {
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    subscriptionStatus: stripeSubscription.status,
                    stripeSubscriptionId: stripeSubscription.id // Always update subscription ID
                };
                
                // Only add currentPeriodEnd if we have a valid value
                if (currentPeriodEnd) {
                    updateData.currentPeriodEnd = currentPeriodEnd;
                }
                
                // Always update tier if we determined it from the price ID (Stripe is source of truth)
                if (tierFromPriceId) {
                    updateData.subscriptionTier = tierFromPriceId;
                    console.log('Updating subscriptionTier in Firestore to:', tierFromPriceId);
                }
                
                await db.collection('users').doc(userId).update(updateData);

                // Update custom claims (only if we have valid data)
                const claimsUpdate = {
                    ...customClaims,
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    subscriptionStatus: stripeSubscription.status,
                    stripeSubscriptionId: stripeSubscription.id // Always update subscription ID
                };
                
                // Only add currentPeriodEnd if we have a valid value
                if (currentPeriodEnd) {
                    claimsUpdate.currentPeriodEnd = currentPeriodEnd;
                }
                
                // Always update tier if we determined it from the price ID (Stripe is source of truth)
                if (tierFromPriceId) {
                    claimsUpdate.subscriptionTier = tierFromPriceId;
                    console.log('Updating subscriptionTier in custom claims to:', tierFromPriceId);
                }
                
                await admin.auth().setCustomUserClaims(userId, claimsUpdate);

                // Also update the subscription object we're returning
                subscription.stripeSubscriptionId = stripeSubscription.id;

                console.log('Updated subscription data from Stripe for user:', userId);
            } catch (error) {
                console.error('Error processing subscription from Stripe:', error);
                // Continue with existing data if Stripe processing fails
            }
        } else {
            console.log('No subscription found in Stripe for customer ID:', subscription.stripeCustomerId);
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

        const { tier, priceId, successUrl, cancelUrl, couponCode, isUpgrade } = body;

        // Support all tier names (including legacy names)
        const validTiers = ['viewer', 'creator', 'proCreator', 'standard', 'pro'];
        if (!tier || !validTiers.includes(tier)) {
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
        const userData = userDoc.data() || {};
        let stripeCustomerId = userData.stripeCustomerId;
        const existingSubscriptionId = userData.stripeSubscriptionId;

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

        // Normalize tier name (handle legacy names)
        let normalizedTier = tier;
        if (tier === 'standard') {
            normalizedTier = 'creator';
        } else if (tier === 'pro') {
            normalizedTier = 'proCreator';
        }

        // Prepare checkout session parameters
        const sessionParams = {
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
                tier: normalizedTier
            }
        };

        // Validate and add coupon code if provided
        if (couponCode && couponCode.trim()) {
            const trimmedCoupon = couponCode.trim();
            let promotionCodeId = null;
            let couponId = null;
            
            try {
                // First, try to retrieve as a promotion code (customer-facing codes like "Masky-Progenitor")
                // List all active promotion codes and find a match (case-insensitive)
                try {
                    // Try to find promotion code by exact code match first (case-sensitive)
                    let matchedPromoCode = null;
                    
                    // First, try exact match (case-sensitive) with expanded coupon
                    try {
                        const exactMatch = await stripe.promotionCodes.list({
                            code: trimmedCoupon,
                            limit: 1,
                            active: true,
                            expand: ['data.coupon']
                        });
                        
                        if (exactMatch.data.length > 0) {
                            matchedPromoCode = exactMatch.data[0];
                            console.log(`Found exact match for promotion code: "${trimmedCoupon}"`);
                        }
                    } catch (exactError) {
                        console.log(`Exact match failed, trying case-insensitive search: ${exactError.message}`);
                    }
                    
                    // If no exact match, search all active codes (case-insensitive)
                    if (!matchedPromoCode) {
                        let allPromotionCodes = [];
                        let hasMore = true;
                        let startingAfter = null;
                        
                        while (hasMore) {
                            const params = {
                                limit: 100,
                                active: true,
                                expand: ['data.coupon']
                            };
                            if (startingAfter) {
                                params.starting_after = startingAfter;
                            }
                            
                            const promotionCodesResponse = await stripe.promotionCodes.list(params);
                            allPromotionCodes = allPromotionCodes.concat(promotionCodesResponse.data);
                            
                            hasMore = promotionCodesResponse.has_more;
                            if (hasMore && promotionCodesResponse.data.length > 0) {
                                startingAfter = promotionCodesResponse.data[promotionCodesResponse.data.length - 1].id;
                            } else {
                                hasMore = false;
                            }
                        }
                        
                        console.log(`Found ${allPromotionCodes.length} active promotion codes. Searching for: "${trimmedCoupon}"`);
                        
                        // Find case-insensitive match by the customer-facing code
                        matchedPromoCode = allPromotionCodes.find(
                            pc => {
                                if (!pc.code) return false;
                                const match = pc.code.toLowerCase() === trimmedCoupon.toLowerCase();
                                if (match) {
                                    console.log(`Matched promotion code: "${pc.code}" (ID: ${pc.id})`);
                                }
                                return match;
                            }
                        );
                        
                        if (!matchedPromoCode) {
                            console.log(`Promotion code "${trimmedCoupon}" not found. Available codes:`, 
                                allPromotionCodes.map(pc => pc.code).filter(Boolean).slice(0, 10));
                        }
                    }
                    
                    if (matchedPromoCode) {
                        promotionCodeId = matchedPromoCode.id;
                        
                        // Extract coupon ID from promotion object
                        // Stripe promotion codes have the structure: promotion.coupon (string ID) or promotion.coupon (expanded object)
                        if (matchedPromoCode.promotion && matchedPromoCode.promotion.coupon) {
                            if (typeof matchedPromoCode.promotion.coupon === 'string') {
                                couponId = matchedPromoCode.promotion.coupon;
                            } else if (matchedPromoCode.promotion.coupon.id) {
                                couponId = matchedPromoCode.promotion.coupon.id;
                            }
                        }
                        
                        // Fallback: try old structure (direct coupon property) for backwards compatibility
                        if (!couponId && matchedPromoCode.coupon) {
                            if (typeof matchedPromoCode.coupon === 'string') {
                                couponId = matchedPromoCode.coupon;
                            } else if (matchedPromoCode.coupon.id) {
                                couponId = matchedPromoCode.coupon.id;
                            }
                        }
                        
                        if (!couponId) {
                            throw new Error(`Unable to extract coupon ID from promotion code. Promotion structure: ${JSON.stringify(matchedPromoCode.promotion)}`);
                        }
                        
                        console.log(`Found promotion code "${trimmedCoupon}" -> promo ID: ${promotionCodeId}, coupon ID: ${couponId}`);
                    }
                } catch (promoError) {
                    // If promotion code lookup fails, try as coupon ID
                    console.error(`Promotion code lookup failed, trying as coupon ID: ${trimmedCoupon}`, promoError.message, promoError.stack);
                }
                
                // If not found as promotion code, try as coupon ID directly
                if (!couponId) {
                    try {
                        const coupon = await stripe.coupons.retrieve(trimmedCoupon);
                        if (coupon.valid) {
                            couponId = coupon.id;
                        } else {
                            return {
                                statusCode: 400,
                                body: JSON.stringify({ 
                                    error: 'Invalid coupon code',
                                    message: 'This coupon code is no longer valid'
                                })
                            };
                        }
                    } catch (couponError) {
                        // Coupon ID also not found
                        throw new Error('COUPON_NOT_FOUND');
                    }
                }
                
                // Validate the coupon is still valid
                const coupon = await stripe.coupons.retrieve(couponId);
                if (!coupon.valid) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ 
                            error: 'Invalid coupon code',
                            message: 'This coupon code is no longer valid'
                        })
                    };
                }
                
                // Add discount to checkout session
                // If we found a promotion code, use promotion_code parameter
                // Otherwise, use coupon parameter
                if (promotionCodeId) {
                    sessionParams.discounts = [{
                        promotion_code: promotionCodeId
                    }];
                } else {
                    sessionParams.discounts = [{
                        coupon: couponId
                    }];
                }
                
            } catch (error) {
                // Handle specific errors
                if (error.message === 'COUPON_NOT_FOUND' || 
                    (error.type === 'StripeInvalidRequestError' && error.code === 'resource_missing')) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ 
                            error: 'Invalid coupon code',
                            message: `Coupon code "${trimmedCoupon}" not found. Please check the code and try again.`
                        })
                    };
                }
                // Re-throw other errors to be caught by outer catch
                throw error;
            }
        }

        // Handle upgrades for existing subscribers
        if (isUpgrade && existingSubscriptionId) {
            try {
                // Get the existing subscription
                const existingSubscription = await stripe.subscriptions.retrieve(existingSubscriptionId);
                
                // If subscription is active, we'll let Stripe handle the upgrade through checkout
                // The checkout session will create a new subscription, and we can handle the upgrade
                // in the webhook when checkout.session.completed fires
                // For now, we'll create the checkout session normally and Stripe will handle proration
                
                // Add subscription_data to indicate this is an upgrade
                sessionParams.subscription_data = {
                    metadata: {
                        firebaseUID: userId,
                        tier: normalizedTier,
                        isUpgrade: 'true',
                        previousSubscriptionId: existingSubscriptionId
                    }
                };
            } catch (error) {
                console.error('Error retrieving existing subscription:', error);
                // Continue with normal checkout if subscription retrieval fails
            }
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create(sessionParams);

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
 * Create donation checkout session
 */
async function createDonationCheckoutSession(event) {
    try {
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

        const { userId, amount, successUrl, cancelUrl, viewerId } = body;

        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing userId' })
            };
        }

        if (!amount || amount < 1) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid donation amount' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        const userData = userDoc.data();
        
        // Get broadcaster name (prefer twitchUsername, fallback to displayName)
        const broadcasterName = userData.twitchUsername || userData.displayName || 'Creator';

        // Calculate amount with Stripe processing fees
        // Stripe fee: 2.9% + $0.30 per transaction
        // To receive the desired amount, we need to charge: (desired_amount + 0.30) / (1 - 0.029)
        const stripeFeeRate = 0.029; // 2.9%
        const stripeFixedFee = 0.30; // $0.30
        const amountWithFees = (amount + stripeFixedFee) / (1 - stripeFeeRate);
        const amountToCharge = Math.ceil(amountWithFees * 100) / 100; // Round up to nearest cent
        const actualFee = amountToCharge - amount;

        // Create checkout session for donation (one-time payment)
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Donation to ${broadcasterName}`,
                            description: 'Thank you for your support!'
                        },
                        unit_amount: Math.round(amountToCharge * 100) // Convert to cents
                    },
                    quantity: 1
                }
            ],
            mode: 'payment',
            success_url: successUrl || `${event.headers.origin || 'https://masky.ai'}/user.html?donation=success`,
            cancel_url: cancelUrl || `${event.headers.origin || 'https://masky.ai'}/user.html?donation=cancelled`,
            metadata: {
                type: 'donation',
                userId: userId,
                viewerId: viewerId || '',
                amount: amount.toString(), // Original donation amount (what the creator receives)
                amountCharged: amountToCharge.toFixed(2), // Amount charged to donor (includes fees)
                stripeFee: actualFee.toFixed(2), // Stripe processing fee
                broadcasterName: broadcasterName,
                createdAt: new Date().toISOString()
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating donation checkout session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create donation checkout session',
                message: error.message 
            })
        };
    }
}

/**
 * Create custom video checkout session
 */
async function createCustomVideoCheckoutSession(event) {
    try {
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

        const { userId, viewerId, videoUrl, message, avatarId, amount, successUrl, cancelUrl } = body;

        if (!userId || !viewerId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing userId or viewerId' })
            };
        }

        if (!amount || amount < 1) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid amount' })
            };
        }

        // Initialize Stripe
        const { stripe } = await stripeInitializer.initialize();

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        const userData = userDoc.data();

        // Create checkout session for custom video (one-time payment)
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `Custom Video for ${userData.displayName || 'Creator'}`,
                            description: message || 'Custom video to play on stream'
                        },
                        unit_amount: Math.round(amount * 100) // Convert to cents
                    },
                    quantity: 1
                }
            ],
            mode: 'payment',
            success_url: successUrl || `${event.headers.origin || 'https://masky.ai'}/user.html?video=success`,
            cancel_url: cancelUrl || `${event.headers.origin || 'https://masky.ai'}/user.html?video=cancelled`,
            metadata: {
                type: 'custom-video',
                userId: userId,
                viewerId: viewerId,
                videoUrl: videoUrl || '',
                message: message || '',
                avatarId: avatarId || '',
                amount: amount.toString()
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: session.url })
        };

    } catch (error) {
        console.error('Error creating custom video checkout session:', error);
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
 * Create custom video (after payment or with credits)
 */
async function createCustomVideo(event) {
    try {
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

        const { userId, viewerId, videoUrl, message, avatarId, paid } = body;

        if (!userId || !viewerId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing userId or viewerId' })
            };
        }

        if (!videoUrl) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing videoUrl' })
            };
        }

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        const userData = userDoc.data();
        const viewerDoc = await db.collection('users').doc(viewerId).get();
        const viewerData = viewerDoc.exists ? viewerDoc.data() : {};

        // Create custom video event in Firestore
        const customVideoData = {
            userId: userId,
            viewerId: viewerId,
            videoUrl: videoUrl,
            message: message || null,
            avatarId: avatarId || null,
            paid: paid === true,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Store in custom videos collection
        const videoRef = await db.collection('customVideos').add(customVideoData);

        // Publish custom video event to user's events collection for stream overlay
        const customVideoEventData = {
            type: 'custom-video',
            videoId: videoRef.id,
            videoUrl: videoUrl,
            message: message || null,
            avatarId: avatarId || null,
            viewerName: viewerData.displayName || 'Anonymous',
            viewerId: viewerId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        // Store in user's events collection for overlay
        await db.collection('users').doc(userId)
            .collection('events').doc('custom-video')
            .collection('alerts').add(customVideoEventData);

        // If paid, update viewer's video credits or tribe membership
        if (paid) {
            // This will be handled by the webhook when payment completes
            // For now, we'll just mark it as paid
        } else {
            // Using credits - update tribe membership if applicable
            const userPageConfig = userData.userPageConfig || {};
            const tribeMemberships = viewerData.tribeMemberships || {};
            const membership = tribeMemberships[userId];

            if (membership && userPageConfig.monthlyTribeVideos) {
                // Increment free videos used this month
                const now = new Date();
                const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                
                if (membership.currentMonth !== currentMonth) {
                    // New month, reset counter
                    await db.collection('users').doc(viewerId).set({
                        tribeMemberships: {
                            ...tribeMemberships,
                            [userId]: {
                                ...membership,
                                currentMonth: currentMonth,
                                freeVideosUsedThisMonth: 1
                            }
                        }
                    }, { merge: true });
                } else {
                    // Same month, increment
                    await db.collection('users').doc(viewerId).set({
                        tribeMemberships: {
                            ...tribeMemberships,
                            [userId]: {
                                ...membership,
                                freeVideosUsedThisMonth: (membership.freeVideosUsedThisMonth || 0) + 1
                            }
                        }
                    }, { merge: true });
                }
            }
        }

        console.log('Custom video created:', { videoId: videoRef.id, userId, viewerId });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                videoId: videoRef.id
            })
        };

    } catch (error) {
        console.error('Error creating custom video:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create custom video',
                message: error.message 
            })
        };
    }
}

/**
 * Join tribe - deducts credits and adds user to tribe
 */
async function joinTribe(event) {
    try {
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

        const { userId } = body;

        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing userId' })
            };
        }

        // Verify authentication
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        const idToken = authHeader.substring(7);
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(idToken);
        const viewerId = decoded.uid;

        const db = admin.firestore();

        // Get creator's user page config
        const creatorDoc = await db.collection('users').doc(userId).get();
        if (!creatorDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Creator not found' })
            };
        }

        const creatorData = creatorDoc.data();
        const userPageConfig = creatorData.userPageConfig || {};
        const tribeJoinCost = userPageConfig.tribeJoinCost || 10;

        // Get viewer's data
        const viewerDoc = await db.collection('users').doc(viewerId).get();
        if (!viewerDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Viewer not found' })
            };
        }

        const viewerData = viewerDoc.data();
        const tribeMemberships = viewerData.tribeMemberships || {};

        // Check if already a member
        if (tribeMemberships[userId]) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Already a member of this tribe' })
            };
        }

        // Determine if viewer is a Twitch subscriber of this creator
        let isSubscriber = false;
        try {
            // Get creator auth record to read Twitch custom claims
            const creatorAuthRecord = await admin.auth().getUser(userId);
            const creatorClaims = creatorAuthRecord.customClaims || {};
            const creatorAccessToken = creatorClaims.twitchAccessToken || null;
            const creatorTwitchId = creatorClaims.twitchId || null;

            // Get viewer Twitch ID from decoded token/custom claims
            const viewerAuthRecord = await admin.auth().getUser(viewerId);
            const viewerClaims = viewerAuthRecord.customClaims || {};
            const viewerTwitchId = viewerClaims.twitchId || null;

            if (creatorAccessToken && creatorTwitchId && viewerTwitchId) {
                // Use broadcaster token to check if viewer is subscribed to broadcaster
                await twitchInitializer.initialize();
                const { clientId } = twitchInitializer.getCredentials();

                const url = new URL('https://api.twitch.tv/helix/subscriptions');
                url.searchParams.set('broadcaster_id', creatorTwitchId);
                url.searchParams.set('user_id', viewerTwitchId);

                const resp = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${creatorAccessToken}`,
                        'Client-Id': clientId
                    }
                });

                if (resp.ok) {
                    const data = await resp.json();
                    // If data array has at least one entry, the viewer is subscribed
                    isSubscriber = Array.isArray(data.data) && data.data.length > 0;
                } else {
                    // If unauthorized/forbidden or other error, treat as not a subscriber (non-blocking)
                    // This preserves normal paid-join behavior when scopes are missing
                    isSubscriber = false;
                }
            }
        } catch (subErr) {
            // Fail-safe: any error in subscription check should not break join flow; proceed as non-subscriber
            console.warn('Twitch subscription check failed; proceeding without free join', {
                error: subErr?.message
            });
            isSubscriber = false;
        }

        // If NOT a subscriber, enforce balance >= join cost; subscribers join free
        let shouldChargeForJoin = !isSubscriber;

        // Calculate current balance (donations - spent on paid videos) only if needed
        let balance = 0;
        if (shouldChargeForJoin) {
            const donationsSnapshot = await db.collection('donations')
                .where('userId', '==', userId)
                .where('viewerId', '==', viewerId)
                .get();

            let totalDonated = 0;
            donationsSnapshot.forEach(doc => {
                const donation = doc.data();
                totalDonated += donation.amount || 0;
            });

            const customVideoPrice = userPageConfig.customVideoPrice || 5;
            const paidVideosSnapshot = await db.collection('customVideos')
                .where('userId', '==', userId)
                .where('viewerId', '==', viewerId)
                .where('paid', '==', true)
                .get();

            const totalSpent = paidVideosSnapshot.size * customVideoPrice;
            balance = totalDonated - totalSpent;

            // Check if balance is sufficient
            if (balance < tribeJoinCost) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ 
                        error: 'Insufficient balance',
                        balance: balance,
                        required: tribeJoinCost
                    })
                };
            }
        }

        // Charge only if not a subscriber
        if (shouldChargeForJoin) {
            // Deduct the cost by creating a "paid" custom video entry (this represents the cost)
            const joinCostVideoData = {
                userId: userId,
                viewerId: viewerId,
                videoUrl: null,
                message: 'Tribe Join Fee',
                avatarId: null,
                paid: true,
                isTribeJoin: true, // Special flag to indicate this is a tribe join fee
                status: 'completed',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('customVideos').add(joinCostVideoData);
        }

        // Add viewer to tribe
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        await db.collection('users').doc(viewerId).set({
            tribeMemberships: {
                ...tribeMemberships,
                [userId]: {
                    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
                    currentMonth: currentMonth,
                    freeVideosUsedThisMonth: 0
                }
            }
        }, { merge: true });

        console.log('User joined tribe:', { userId, viewerId, tribeJoinCost, isSubscriber });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                message: 'Successfully joined tribe',
                isSubscriber
            })
        };

    } catch (error) {
        console.error('Error joining tribe:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to join tribe',
                message: error.message 
            })
        };
    }
}

/**
 * Redeem points for a redemption
 */
async function redeemPoints(event) {
    try {
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

        const { userId, viewerId, redemptionId, redemptionName, creditCost, customString, videoUrl, message, avatarId } = body;

        if (!userId || !viewerId || !redemptionId || !creditCost) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // Initialize Firebase
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Get user and viewer data
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        const viewerDoc = await db.collection('users').doc(viewerId).get();
        if (!viewerDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Viewer not found' })
            };
        }

        const viewerData = viewerDoc.data();

        // Calculate user's current points (donations - spent)
        const donationsRef = db.collection('donations');
        const donationsQuery = donationsRef
            .where('userId', '==', userId)
            .where('viewerId', '==', viewerId);
        const donationsSnapshot = await donationsQuery.get();
        
        let totalDonated = 0;
        donationsSnapshot.forEach(doc => {
            const donation = doc.data();
            // Ensure amount is a number (handle potential string storage)
            const amount = typeof donation.amount === 'number' ? donation.amount : parseFloat(donation.amount || 0);
            totalDonated += amount || 0;
        });

        // Get total spent on redemptions
        const redemptionsRef = db.collection('redemptions');
        const redemptionsQuery = redemptionsRef
            .where('userId', '==', userId)
            .where('viewerId', '==', viewerId);
        const redemptionsSnapshot = await redemptionsQuery.get();
        
        let totalSpent = 0;
        redemptionsSnapshot.forEach(doc => {
            const redemption = doc.data();
            // Ensure creditCost is a number (handle potential string storage)
            const creditCost = typeof redemption.creditCost === 'number' ? redemption.creditCost : parseFloat(redemption.creditCost || 0);
            totalSpent += creditCost || 0;
        });

        const availablePoints = totalDonated - totalSpent;

        // Check if user has enough points (use small epsilon for floating point comparison)
        const epsilon = 0.01;
        if (availablePoints + epsilon < creditCost) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Not enough points' })
            };
        }

        // Create redemption record
        const redemptionData = {
            userId: userId,
            viewerId: viewerId,
            viewerName: viewerData.displayName || 'Anonymous',
            viewerTwitchUsername: viewerData.twitchUsername || null,
            redemptionId: redemptionId,
            redemptionName: redemptionName || 'Unknown',
            creditCost: creditCost,
            customString: customString || null,
            dismissed: false,
            refunded: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // If it's a custom video redemption, handle it specially
        if (redemptionId === 'custom-video') {
            if (!videoUrl) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Missing videoUrl for custom video redemption' })
                };
            }

            // Create custom video
            const customVideoData = {
                userId: userId,
                viewerId: viewerId,
                videoUrl: videoUrl,
                message: message || null,
                avatarId: avatarId || null,
                paid: false, // Using points, not paid
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };

            const videoRef = await db.collection('customVideos').add(customVideoData);

            // Store videoId in redemption record for approval later
            // Do NOT publish event immediately - it will be published when streamer approves
            redemptionData.videoId = videoRef.id;
        }

        // Store redemption
        const redemptionRef = await db.collection('redemptions').add(redemptionData);

        // If redemption should show in queue, publish event
        const userData = userDoc.data();
        const userPageConfig = userData.userPageConfig || {};
        const redemptions = userPageConfig.redemptions || [];
        const redemptionConfig = redemptions.find(r => r.id === redemptionId);
        
        if (redemptionConfig && redemptionConfig.showInQueue !== false) {
            // Publish redemption event to user's events collection for stream overlay
            const redemptionEventData = {
                type: 'redemption',
                redemptionId: redemptionRef.id,
                redemptionName: redemptionName,
                donorName: viewerData.displayName || 'Anonymous',
                customString: customString || null,
                viewerId: viewerId,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('users').doc(userId)
                .collection('events').doc('redemption')
                .collection('alerts').add(redemptionEventData);
        }

        console.log('Redemption created:', { redemptionId: redemptionRef.id, userId, viewerId, creditCost });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                redemptionId: redemptionRef.id,
                remainingPoints: availablePoints - creditCost
            })
        };

    } catch (error) {
        console.error('Error redeeming points:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to redeem points',
                message: error.message 
            })
        };
    }
}

/**
 * Refund a redemption - removes the redemption and refunds points to the user
 */
async function refundRedemption(event) {
    try {
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

        const { redemptionId } = body;

        if (!redemptionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing redemptionId' })
            };
        }

        // Verify authentication
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        const idToken = authHeader.substring(7);
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const decoded = await admin.auth().verifyIdToken(idToken);
        const streamerId = decoded.uid;

        const db = admin.firestore();

        // Get redemption data
        const redemptionRef = db.collection('redemptions').doc(redemptionId);
        const redemptionDoc = await redemptionRef.get();

        if (!redemptionDoc.exists) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Redemption not found' })
            };
        }

        const redemptionData = redemptionDoc.data();

        // Verify that the authenticated user is the streamer (owner of the redemption)
        if (redemptionData.userId !== streamerId) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'Only the streamer can refund redemptions' })
            };
        }

        // Check if already refunded or dismissed
        if (redemptionData.refunded || redemptionData.dismissed) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Redemption already processed' })
            };
        }

        // Mark as refunded and delete the redemption record
        // This effectively refunds the points since points = donations - redemptions
        await redemptionRef.delete();

        // If it was a custom video, we might want to delete the video too
        // For now, we'll just delete the redemption record

        console.log('Redemption refunded:', { redemptionId, userId: redemptionData.userId, viewerId: redemptionData.viewerId, creditCost: redemptionData.creditCost });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                message: 'Redemption refunded successfully'
            })
        };

    } catch (error) {
        console.error('Error refunding redemption:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to refund redemption',
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
                
                // Handle subscription checkout (mode === 'subscription')
                if (session.mode === 'subscription') {
                    const userId = session.metadata.firebaseUID;
                    const tier = session.metadata.tier;
                    const customerId = session.customer;
                    const subscriptionId = session.subscription;

                    // Get the subscription details from Stripe to get current_period_end and metadata
                    const { stripe } = await stripeInitializer.initialize();
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    
                    // Check if this is an upgrade from subscription metadata
                    const isUpgrade = subscription.metadata?.isUpgrade === 'true';
                    const previousSubscriptionId = subscription.metadata?.previousSubscriptionId;

                    // If this is an upgrade, cancel the previous subscription
                    if (isUpgrade && previousSubscriptionId) {
                        try {
                            const previousSubscription = await stripe.subscriptions.retrieve(previousSubscriptionId);
                            
                            // Only cancel if it's still active
                            if (previousSubscription.status === 'active' || previousSubscription.status === 'trialing') {
                                await stripe.subscriptions.cancel(previousSubscriptionId);
                                console.log(`Cancelled previous subscription ${previousSubscriptionId} for upgrade to ${tier}`);
                            }
                        } catch (error) {
                            console.error('Error cancelling previous subscription:', error);
                            // Continue even if cancellation fails
                        }
                    }

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
                }
                // Handle custom video checkout (mode === 'payment')
                else if (session.mode === 'payment' && session.metadata?.type === 'custom-video') {
                    const userId = session.metadata.userId;
                    const viewerId = session.metadata.viewerId;
                    const videoUrl = session.metadata.videoUrl;
                    const message = session.metadata.message || null;
                    const avatarId = session.metadata.avatarId || null;
                    const amount = parseFloat(session.metadata.amount || '0');
                    const paymentIntentId = session.payment_intent;

                    if (userId && viewerId && videoUrl && amount > 0) {
                        // Create the custom video
                        const customVideoData = {
                            userId: userId,
                            viewerId: viewerId,
                            videoUrl: videoUrl,
                            message: message,
                            avatarId: avatarId,
                            paid: true,
                            status: 'pending',
                            paymentIntentId: paymentIntentId,
                            sessionId: session.id,
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        };

                        // Store in custom videos collection
                        const videoRef = await db.collection('customVideos').add(customVideoData);

                        // Get viewer data
                        const viewerDoc = await db.collection('users').doc(viewerId).get();
                        const viewerData = viewerDoc.exists ? viewerDoc.data() : {};

                        // Publish custom video event to user's events collection for stream overlay
                        const customVideoEventData = {
                            type: 'custom-video',
                            videoId: videoRef.id,
                            videoUrl: videoUrl,
                            message: message,
                            avatarId: avatarId,
                            viewerName: session.customer_details?.name || viewerData.displayName || 'Anonymous',
                            viewerId: viewerId,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        };

                        // Store in user's events collection for overlay
                        await db.collection('users').doc(userId)
                            .collection('events').doc('custom-video')
                            .collection('alerts').add(customVideoEventData);

                        console.log('Custom video payment processed:', { videoId: videoRef.id, userId, viewerId, amount });
                    }
                }
                // Handle donation checkout (mode === 'payment')
                else if (session.mode === 'payment' && session.metadata?.type === 'donation') {
                    const userId = session.metadata.userId;
                    const amount = parseFloat(session.metadata.amount || '0'); // Original donation amount (what creator receives)
                    const amountCharged = parseFloat(session.metadata.amountCharged || amount); // Amount charged to donor (includes fees)
                    const stripeFee = parseFloat(session.metadata.stripeFee || '0'); // Stripe processing fee
                    const broadcasterName = session.metadata.broadcasterName || null;
                    const paymentIntentId = session.payment_intent;

                    if (userId && amount > 0) {
                        // Get user data
                        const userDoc = await db.collection('users').doc(userId).get();
                        if (userDoc.exists) {
                            // Get viewer ID from session metadata if available
                            const viewerId = session.metadata?.viewerId || null;

                            // Create donation event in Firestore
                            const donationData = {
                                userId: userId,
                                viewerId: viewerId, // Store who made the donation
                                amount: amount, // Original donation amount (what creator receives)
                                amountCharged: amountCharged, // Amount charged to donor (includes fees)
                                stripeFee: stripeFee, // Stripe processing fee
                                broadcasterName: broadcasterName, // Broadcaster name at time of donation
                                currency: 'usd',
                                paymentIntentId: paymentIntentId,
                                sessionId: session.id,
                                donorEmail: session.customer_details?.email || null,
                                donorName: session.customer_details?.name || null,
                                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                createdAt: session.metadata.createdAt || new Date().toISOString(), // Store original creation timestamp
                                processed: false
                            };

                            // Store donation in donations collection
                            await db.collection('donations').add(donationData);

                            // Publish donation event to user's events collection for stream overlay
                            const donationEventData = {
                                type: 'donation',
                                amount: amount,
                                currency: 'usd',
                                donorName: session.customer_details?.name || 'Anonymous',
                                donorEmail: session.customer_details?.email || null,
                                message: session.customer_details?.name 
                                    ? `${session.customer_details.name} donated $${amount.toFixed(2)}!`
                                    : `Someone donated $${amount.toFixed(2)}!`,
                                timestamp: admin.firestore.FieldValue.serverTimestamp()
                            };

                            // Store in user's events collection for overlay
                            await db.collection('users').doc(userId)
                                .collection('events').doc('donation')
                                .collection('alerts').add(donationEventData);

                            console.log('Donation processed:', { userId, amount, paymentIntentId });
                        }
                    }
                }
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

                    // Determine tier from subscription price ID (source of truth)
                    let tier = 'free';
                    if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
                        const priceId = subscription.items.data[0].price.id;
                        console.log('Webhook: Found price ID in subscription:', priceId);
                        
                        // Map price ID to tier using our helper function
                        tier = getTierFromPriceId(priceId);
                        console.log('Webhook: Mapped tier from price ID:', tier);
                    } else {
                        // Fallback: try to get tier from subscription metadata
                        tier = subscription.metadata?.tier || 'free';
                        console.log('Webhook: Using tier from metadata:', tier);
                        
                        // If still no tier, use existing tier from Firestore
                        if (tier === 'free') {
                            const existingData = userDoc.data();
                            tier = existingData.subscriptionTier || 'free';
                            console.log('Webhook: Using existing tier from Firestore:', tier);
                        }
                    }

                    const updateData = {
                        subscriptionStatus: subscription.status,
                        subscriptionTier: tier,
                        currentPeriodEnd: subscription.current_period_end,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                        stripeSubscriptionId: subscription.id,
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

                    console.log('Subscription updated for user:', userId, 'tier:', tier);
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

    