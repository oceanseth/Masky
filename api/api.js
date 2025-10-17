const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    region: 'us-east-1',
    signatureVersion: 'v4',
    endpoint: 'https://s3.us-east-1.amazonaws.com'  // Specify regional endpoint
});
const firebaseInitializer = require('./utils/firebaseInit');
const stripeInitializer = require('./utils/stripeInit');
const twitchInitializer = require('./utils/twitchInit');
//twitch oauth url at https://masky.net/api/twitch_oauth

// Exchange Twitch authorization code for access token
const handleTwitchOAuthCallback = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { code, redirectUri } = body;

        if (!code) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing authorization code' })
            };
        }

        // Initialize Twitch credentials
        const { clientId, clientSecret } = await twitchInitializer.initialize();

        // Exchange code for access token
        const tokenUrl = 'https://id.twitch.tv/oauth2/token';
        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri || 'https://masky.net/auth/callback'
        });

        const https = require('https');
        const url = require('url');
        
        const tokenResponse = await new Promise((resolve, reject) => {
            const postData = params.toString();
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const parsedUrl = url.parse(tokenUrl);
            options.hostname = parsedUrl.hostname;
            options.path = parsedUrl.path;

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Failed to parse token response'));
                        }
                    } else {
                        reject(new Error(`Token exchange failed: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });

        if (!tokenResponse.access_token) {
            throw new Error('No access token in response');
        }

        const accessToken = tokenResponse.access_token;

        // Verify Twitch token and get user info
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
        console.error('Twitch OAuth callback error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal server error',
                message: error.message 
            })
        };
    }
};

// Handle Twitch OAuth login (legacy - for direct access token)
const handleTwitchOAuth = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
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
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
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
    const path = event.path || event.rawPath || '';
    const method = event.httpMethod || event.requestContext?.http?.method;

    // Handle Twitch OAuth callback (authorization code exchange)
    if (path.includes('/twitch_oauth_callback') && method === 'POST') {
        const response = await handleTwitchOAuthCallback(event);
        return {
            ...response,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        };
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

    // Default response for unmatched routes
    return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Route not found' })
    };
}