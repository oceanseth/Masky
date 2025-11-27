import { config } from './config.js';
import { getCurrentUser, signInWithTwitch } from './firebase.js';

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';
const DEFAULT_REQUIRED_SCOPES = {
    channelPointsRewards: ['channel:read:redemptions']
};

let twitchFinishedLogin = () => {};

function normalizeEndpoint(endpoint = '') {
    if (!endpoint) return '';
    return endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
}

function buildTwitchUrl(endpoint, query = {}) {
    const url = new URL(`${TWITCH_API_BASE}/${normalizeEndpoint(endpoint)}`);
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.append(key, value);
        }
    });
    return url;
}

async function getUserAccessToken({ forceRefresh = false } = {}) {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('User is not authenticated with Twitch');
    }

    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const token = tokenResult?.claims?.twitchAccessToken;
    if (!token) {
        throw new Error('Missing Twitch access token. Please reconnect your Twitch account.');
    }
    return token;
}

function extractTwitchBroadcasterId(user) {
    if (!user) return null;
    const { uid } = user;
    if (typeof uid === 'string' && uid.startsWith('twitch:')) {
        return uid.slice('twitch:'.length);
    }
    return null;
}

async function refreshUserIdToken() {
    const user = getCurrentUser();
    if (!user) return;
    try {
        await user.getIdToken(true);
    } catch (error) {
        console.warn('[twitch] Failed to refresh ID token after login:', error);
    }
}

async function performTwitchLogin(extraScopes = []) {
    const scopes = Array.isArray(extraScopes) ? extraScopes : [];
    await signInWithTwitch(scopes);
    await refreshUserIdToken();
    try {
        twitchFinishedLogin?.();
    } catch (callbackError) {
        console.error('[twitch] Error running twitchFinishedLogin callback:', callbackError);
    }
}

function shouldRetry(response, retryAttempt) {
    if (!response) return false;
    if (retryAttempt) return false;
    return response.status === 401 || response.status === 403;
}

export function setTwitchFinishedLogin(callback) {
    const previous = twitchFinishedLogin;
    if (typeof callback === 'function') {
        twitchFinishedLogin = callback;
    } else {
        twitchFinishedLogin = () => {};
    }
    return previous;
}

export async function twitchLogin(extraScopes = []) {
    await performTwitchLogin(extraScopes);
}

export async function callTwitchUserApi(endpoint, {
    query,
    method = 'GET',
    body,
    headers = {},
    requiredScopes = []
} = {}, retryAttempt = false) {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('User must be logged in with Twitch to use this feature.');
    }

    let accessToken;
    try {
        accessToken = await getUserAccessToken({ forceRefresh: false });
    } catch (error) {
        console.warn('[twitch] Unable to obtain access token, attempting login...', error);
        await performTwitchLogin(requiredScopes);
        accessToken = await getUserAccessToken({ forceRefresh: true });
    }

    const url = buildTwitchUrl(endpoint, query);
    const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': config.twitch.clientId,
        ...headers
    };

    if (body && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
    });

    if (shouldRetry(response, retryAttempt)) {
        console.warn('[twitch] Twitch API returned unauthorized. Initiating re-auth...');
        await performTwitchLogin(requiredScopes);
        return callTwitchUserApi(endpoint, { query, method, body, headers, requiredScopes }, true);
    }

    return response;
}

export async function getRedemptionTitles() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('You must be signed in with Twitch to view channel rewards.');
    }

    const broadcasterId = extractTwitchBroadcasterId(user);
    if (!broadcasterId) {
        throw new Error('Unable to determine Twitch broadcaster ID for the current user.');
    }

    const response = await callTwitchUserApi(
        'channel_points/custom_rewards',
        {
            query: { broadcaster_id: broadcasterId },
            requiredScopes: DEFAULT_REQUIRED_SCOPES.channelPointsRewards
        }
    );

    if (!response.ok) {
        if (response.status === 403) {
            const error = new Error('Twitch only exposes custom rewards to Affiliate or Partner broadcasters. Your rewards will appear here once Twitch unlocks them for your channel.');
            error.code = 'TWITCH_REWARDS_FORBIDDEN';
            throw error;
        }

        const errorText = await response.text().catch(() => 'Unknown error');
        const error = new Error(`Failed to load channel point rewards (${response.status}): ${errorText}`);
        error.code = 'TWITCH_REWARDS_ERROR';
        throw error;
    }

    const json = await response.json().catch(() => ({ data: [] }));
    const rewards = Array.isArray(json?.data) ? json.data : [];
    return rewards.map(reward => ({
        id: reward.id,
        title: reward.title,
        cost: reward.cost,
        prompt: reward.prompt,
        isEnabled: reward.is_enabled !== false
    }));
}

/**
 * Get the current broadcaster's info from Twitch API
 * Returns the broadcaster's login name (username) and display name
 * Uses server-side API endpoint with Firestore caching
 */
export async function getBroadcasterInfo() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('User must be logged in with Twitch to use this feature.');
    }

    // First, try to get from Firestore cache
    try {
        const { db, doc, getDoc } = await import('./firebase.js');
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const cachedInfo = userData.twitchUserInfo;
            const cacheTimestamp = userData.twitchUserInfoUpdatedAt;
            
            // Check if cache is less than 24 hours old
            if (cachedInfo && cacheTimestamp) {
                const cacheAge = Date.now() - cacheTimestamp.toMillis();
                const cacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours
                
                if (cacheAge < cacheMaxAge) {
                    return {
                        id: cachedInfo.id,
                        login: cachedInfo.login,
                        displayName: cachedInfo.displayName,
                        profileImageUrl: cachedInfo.profileImageUrl
                    };
                }
            }
        }
    } catch (error) {
        console.warn('[getBroadcasterInfo] Error checking Firestore cache:', error);
    }

    // If cache miss or error, fetch from our API endpoint
    try {
        const idToken = await user.getIdToken();
        const { config } = await import('./config.js');
        
        const response = await fetch(`${config.api.baseUrl}/api/twitch/user-info`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to load broadcaster info (${response.status}): ${errorText}`);
        }

        const broadcasterInfo = await response.json();
        
        // Update local Firestore cache immediately
        try {
            const { db, doc, setDoc } = await import('./firebase.js');
            const userDocRef = doc(db, 'users', user.uid);
            await setDoc(userDocRef, {
                twitchUserInfo: {
                    id: broadcasterInfo.id,
                    login: broadcasterInfo.login,
                    displayName: broadcasterInfo.displayName,
                    profileImageUrl: broadcasterInfo.profileImageUrl
                },
                twitchUserInfoUpdatedAt: new Date(),
                displayName: broadcasterInfo.displayName,
                photoURL: broadcasterInfo.profileImageUrl,
                twitchUsername: broadcasterInfo.login
            }, { merge: true });
        } catch (cacheError) {
            console.warn('[getBroadcasterInfo] Error updating cache:', cacheError);
        }

        return {
            id: broadcasterInfo.id,
            login: broadcasterInfo.login,
            displayName: broadcasterInfo.displayName,
            profileImageUrl: broadcasterInfo.profileImageUrl
        };
    } catch (error) {
        console.error('[getBroadcasterInfo] Error fetching from API:', error);
        throw error;
    }
}

export const twitchHelpers = {
    getRedemptionTitles,
    twitchLogin,
    setTwitchFinishedLogin,
    callTwitchUserApi,
    getBroadcasterInfo
};
