const AWS = require('aws-sdk');
const https = require('https');
const { URL } = require('url');

AWS.config.update({ region: 'us-east-1' });

// Note: Local environment is loaded in api/api.js handler
// No need to load again here

class TwitchInitializer {
  constructor() {
    this.ssm = new AWS.SSM();
    this.clientId = null;
    this.clientSecret = null;
  }

  // Helper function to make HTTPS requests
  makeHttpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  // Load Twitch credentials from SSM or local environment
  async initialize() {
    try {
      // Return if already initialized
      if (this.clientId && this.clientSecret) {
        return { clientId: this.clientId, clientSecret: this.clientSecret };
      }

      // Check if running locally
      if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
        console.log('🔧 Running in local mode - loading Twitch from environment');
        
        if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
          throw new Error('TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET not found in .env.local. Please copy env.local.example to .env.local and fill in your credentials.');
        }

        this.clientId = process.env.TWITCH_CLIENT_ID;
        this.clientSecret = process.env.TWITCH_CLIENT_SECRET;
      } else {
        // Production mode - load from SSM
        console.log('☁️  Loading Twitch from SSM...');
        
        // Get Client ID
        const clientIdParams = {
          Name: '/masky/production/twitch_client_id',
          WithDecryption: true
        };
        const clientIdResult = await this.ssm.getParameter(clientIdParams).promise();
        
        if (!clientIdResult?.Parameter?.Value) {
          throw new Error('Twitch Client ID not found in SSM');
        }
        this.clientId = clientIdResult.Parameter.Value;

        // Get Client Secret
        const clientSecretParams = {
          Name: '/masky/production/twitch_client_secret',
          WithDecryption: true
        };
        const clientSecretResult = await this.ssm.getParameter(clientSecretParams).promise();
        
        if (!clientSecretResult?.Parameter?.Value) {
          throw new Error('Twitch Client Secret not found in SSM');
        }
        this.clientSecret = clientSecretResult.Parameter.Value;
      }

      return { clientId: this.clientId, clientSecret: this.clientSecret };
    } catch (error) {
      console.error('Failed to initialize Twitch credentials:', error);
      throw error;
    }
  }

  async storeAdminSession(adminSdk, {
    uid,
    twitchUser = {},
    accessToken,
    refreshToken = null,
    expiresIn = null,
    scope = [],
    context = 'login'
  }) {
    if (!adminSdk) {
      throw new Error('Firebase admin SDK instance is required to store admin session');
    }

    if (!uid) {
      throw new Error('Cannot store admin session without a uid');
    }

    if (!accessToken) {
      throw new Error('Cannot store admin session without an access token');
    }

    try {
      const db = adminSdk.firestore();
      const adminDocRef = db.collection('system').doc('adminData');
      const fieldValue = adminSdk.firestore.FieldValue;
      const timestamp = adminSdk.firestore.Timestamp;
      const expiresAtTimestamp = expiresIn
        ? timestamp.fromMillis(Date.now() + (expiresIn * 1000))
        : null;

      const scopes = Array.isArray(scope)
        ? scope
        : (typeof scope === 'string' ? scope.split(' ').map(s => s.trim()).filter(Boolean) : []);

      await adminDocRef.set({
        adminUsers: fieldValue.arrayUnion('twitch:636906032', 'twitch:11867613', 'twitch:1386063343'),
        updatedAt: fieldValue.serverTimestamp()
      }, { merge: true });

      const sessionData = {
        uid,
        provider: 'twitch',
        twitchId: twitchUser?.id || null,
        displayName: twitchUser?.display_name || null,
        photoURL: twitchUser?.profile_image_url || null,
        email: twitchUser?.email || null,
        accessToken,
        refreshToken: refreshToken || null,
        scopes,
        expiresAt: expiresAtTimestamp,
        updatedAt: fieldValue.serverTimestamp()
      };

      if (context === 'login') {
        sessionData.lastLoginAt = fieldValue.serverTimestamp();
      }

      if (context === 'impersonation') {
        sessionData.lastImpersonatedAt = fieldValue.serverTimestamp();
      }

      await adminDocRef.collection('userTokens').doc(uid).set(sessionData, { merge: true });
    } catch (error) {
      console.error('Failed to store admin session data:', error);
      throw error;
    }
  }

  // Verify Twitch token and get user info
  async verifyToken(accessToken) {
    try {
      await this.initialize();

      const options = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': this.clientId
        }
      };
      
      const userData = await this.makeHttpsRequest('https://api.twitch.tv/helix/users', options);
      
      if (!userData.data || userData.data.length === 0) {
        throw new Error('Invalid Twitch access token');
      }

      return userData.data[0];
    } catch (error) {
      console.error('Failed to verify Twitch token:', error);
      throw error;
    }
  }

  // Validate token (check if it's still valid)
  async validateToken(accessToken) {
    try {
      const options = {
        method: 'GET',
        headers: {
          'Authorization': `OAuth ${accessToken}`
        }
      };
      
      return await this.makeHttpsRequest('https://id.twitch.tv/oauth2/validate', options);
    } catch (error) {
      console.error('Failed to validate Twitch token:', error);
      throw error;
    }
  }

  // Get app access token using client credentials flow
  async getAppAccessToken() {
    try {
      await this.initialize();
      console.log('Getting app access token with client ID:', this.clientId ? 'PRESENT' : 'MISSING');
      console.log('Client secret present:', this.clientSecret ? 'YES' : 'NO');
      
      const tokenUrl = 'https://id.twitch.tv/oauth2/token';
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
        scope: 'channel:read:subscriptions'
      });

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

      // Log the response if there's an error
      if (tokenResponse.error) {
        console.error('Twitch token request error:', tokenResponse);
        throw new Error(`Failed to get app access token: ${tokenResponse.error} - ${tokenResponse.message || 'Unknown error'}`);
      }

      if (!tokenResponse.access_token) {
        console.error('Invalid token response:', tokenResponse);
        throw new Error('No access token in response');
      }

      // Log token info (without exposing the full token)
      console.log('App Access Token obtained successfully:', {
        token_length: tokenResponse.access_token.length,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        scope: tokenResponse.scope
      });

      return tokenResponse.access_token;
    } catch (error) {
      console.error('Failed to get app access token:', error);
      throw error;
    }
  }

  // Get credentials
  getCredentials() {
    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret
    };
  }

  /**
   * Send a message to Twitch chat
   * Uses Twitch Helix API to send chat messages
   * @param {string} broadcasterId - The Twitch broadcaster user ID
   * @param {string} accessToken - The broadcaster's Twitch access token (must have chat:edit scope)
   * @param {string} message - The message to send
   * @returns {Promise<Object>} Response from Twitch API
   */
  async sendChatMessage(broadcasterId, accessToken, message) {
    try {
      await this.initialize();
      const { clientId } = this.getCredentials();
      
      // Twitch Helix API endpoint for sending chat messages
      // Note: This endpoint requires the broadcaster to have chat:edit scope
      // and the broadcaster_id must match the user associated with the access token
      const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-Id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          sender_id: broadcasterId, // Moderator ID (same as broadcaster for self-messaging)
          message: message
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { raw: errorText };
        }
        
        // Log detailed error for debugging
        console.error('Failed to send Twitch chat message:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          broadcasterId: broadcasterId,
          messageLength: message.length
        });
        
        // If endpoint doesn't exist (404) or unauthorized (401/403), log but don't throw
        // This allows processing to continue even if chat message fails
        if (response.status === 404) {
          console.warn('Twitch chat message endpoint not found. This might require using IRC or a different API.');
        } else if (response.status === 401 || response.status === 403) {
          console.warn('Twitch access token missing chat:edit scope or is invalid.');
        }
        
        throw new Error(`Twitch API error: ${response.status} - ${errorData.message || errorData.error || errorText}`);
      }

      const data = await response.json();
      console.log('Successfully sent Twitch chat message:', data);
      return data;
    } catch (error) {
      console.error('Error sending Twitch chat message:', error);
      throw error;
    }
  }

  // Create Twitch EventSub subscription
  async createEventSub(event) {
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
      const firebaseInitializer = require('./firebaseInit');
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

      const { type, version, condition } = body;

      if (!type || !version || !condition) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing required fields: type, version, and condition are required' })
        };
      }

      // Get user's Twitch access token
      const userRecord = await admin.auth().getUser(userId);
      const customClaims = userRecord.customClaims || {};
      
      if (!customClaims.twitchAccessToken) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No Twitch access token found. Please reconnect your Twitch account.',
            code: 'TWITCH_TOKEN_MISSING'
          })
        };
      }

      const db = admin.firestore();
      
      // Chat message subscriptions require WebSocket transport, not webhooks
      if (type === 'channel.chat.message') {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Twitch chat message subscriptions require WebSocket transport, not webhooks.',
            code: 'TWITCH_CHAT_WEBSOCKET_REQUIRED'
          })
        };
      }

      // Initialize Twitch credentials from SSM
      const { clientId, clientSecret } = await this.initialize();
      const appToken = await this.getAppAccessToken();
      console.log('Using APP token for EventSub ensure');

      const targetCondition = { ...condition };
      if (type === 'channel.follow' && !targetCondition.moderator_user_id) {
        targetCondition.moderator_user_id = customClaims.twitchId;
      }

      let createdSubscription = null;

      const requiredScopesByType = {
        'channel.subscribe': ['channel:read:subscriptions'],
        'channel.cheer': ['bits:read']
      };
      const requiredScopes = requiredScopesByType[type] || [];
      if (requiredScopes.length > 0) {
        try {
          const validation = await this.validateToken(customClaims.twitchAccessToken);
          const granted = Array.isArray(validation.scopes) ? validation.scopes : [];
          const missing = requiredScopes.filter(s => !granted.includes(s));
          if (missing.length > 0) {
            return {
              statusCode: 400,
              body: JSON.stringify({
                error: `Missing required Twitch scopes: ${missing.join(', ')}`,
                code: 'TWITCH_SCOPES_MISSING'
              })
            };
          }
        } catch (e) {
          console.warn('Failed to validate user token scopes; proceeding may fail:', e.message);
        }
      }

      const requestBody = {
        type,
        version,
        condition: { ...targetCondition },
        transport: {
          method: 'webhook',
          callback: 'https://masky.ai/api/twitch-webhook',
          secret: clientSecret
        }
      };

      const attemptCreateSubscription = async () => {
        const twitchResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${appToken}`,
            'Client-Id': clientId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!twitchResponse.ok) {
          const errorData = await twitchResponse.json().catch(() => ({}));

          if (twitchResponse.status === 409 && errorData?.message?.includes('subscription already exists')) {
            console.log(`[TwitchInit] Subscription for ${type} already exists. Proceeding to sync existing subscriptions.`);
            return null;
          }

          if (errorData.message && errorData.message.includes('Client ID and OAuth token do not match')) {
            return {
              error: {
                statusCode: 400,
                body: JSON.stringify({
                  error: 'Twitch access token is invalid or expired. Please reconnect your Twitch account.',
                  code: 'TWITCH_TOKEN_MISSING'
                })
              }
            };
          }

          throw new Error(`Twitch API error: ${errorData.message || 'Unknown error'}`);
        }

        const subscriptionData = await twitchResponse.json();
        createdSubscription = subscriptionData.data ? subscriptionData.data[0] : null;
        return null;
      };

      const createError = await attemptCreateSubscription();
      if (createError) {
        return createError.error;
      }

      const subscriptions = await this.fetchBroadcasterSubscriptions(appToken, clientId, targetCondition.broadcaster_user_id);
      await this.syncTwitchSubscriptionsToFirestore(admin, db, userId, subscriptions);

      const conditionMatches = (subCondition = {}) => {
        return Object.entries(targetCondition).every(([key, value]) => subCondition[key] === value);
      };

      let matchingSubscription = subscriptions.find(sub => sub.type === type && conditionMatches(sub.condition));

      if (!matchingSubscription) {
        // Remove any conflicting subscriptions of this type for this broadcaster and retry once.
        const conflictingSubs = subscriptions.filter(sub => sub.type === type && sub.transport?.callback && this.isOurCallback(sub.transport.callback));
        for (const sub of conflictingSubs) {
          try {
            await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(sub.id)}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${appToken}`,
                'Client-Id': clientId
              }
            });
            console.log('[TwitchInit] Deleted conflicting Twitch subscription', sub.id, sub.type);
          } catch (deleteErr) {
            console.warn('[TwitchInit] Failed to delete conflicting subscription', sub.id, deleteErr);
          }
        }

        const retryError = await attemptCreateSubscription();
        if (retryError) {
          return retryError.error;
        }

        const retrySubscriptions = await this.fetchBroadcasterSubscriptions(appToken, clientId, targetCondition.broadcaster_user_id);
        await this.syncTwitchSubscriptionsToFirestore(admin, db, userId, retrySubscriptions);
        matchingSubscription = retrySubscriptions.find(sub => sub.type === type && conditionMatches(sub.condition));

        if (!matchingSubscription) {
          throw new Error(`Failed to create Twitch subscription for ${type}. Twitch did not report the subscription after creation.`);
        }

        return {
          statusCode: 200,
          body: JSON.stringify({
            subscription: matchingSubscription,
            subscriptions: retrySubscriptions
          })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          subscription: matchingSubscription,
          subscriptions
        })
      };

    } catch (error) {
      console.error('Error creating Twitch EventSub:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to create EventSub subscription',
          message: error.message 
        })
      };
    }
  }

  isOurCallback(callbackUrl = '') {
    if (!callbackUrl) return false;
    const allowedCallbacks = [
      'https://masky.ai/api/twitch-webhook',
      'https://masky.net/api/twitch-webhook'
    ];
    return allowedCallbacks.includes(callbackUrl);
  }

  async fetchBroadcasterSubscriptions(appToken, clientId, broadcasterUserId) {
    const results = [];
    let cursor = null;

    do {
      const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
      url.searchParams.set('first', '100');
      if (cursor) url.searchParams.set('after', cursor);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${appToken}`,
          'Client-Id': clientId
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch Twitch subscriptions: ${response.status} ${text}`);
      }

      const data = await response.json();
      if (Array.isArray(data.data)) {
        results.push(
          ...data.data.filter(sub => {
            const condition = sub.condition || {};
            return condition.broadcaster_user_id === broadcasterUserId && this.isOurCallback(sub.transport?.callback);
          })
        );
      }

      cursor = data.pagination?.cursor || null;
    } while (cursor);

    return results;
  }

  async syncTwitchSubscriptionsToFirestore(admin, db, userId, subscriptions) {
    const subsCollection = db.collection('users').doc(userId).collection('subscriptions');
    const desiredDocIds = new Set();

    for (const sub of subscriptions) {
      const docId = `twitch_${sub.type}`;
      desiredDocIds.add(docId);
      await subsCollection.doc(docId).set({
        provider: 'twitch',
        eventType: sub.type,
        twitchSubscription: sub,
        isActive: sub.status === 'enabled',
        condition: sub.condition || null,
        transport: sub.transport || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    const existingDocs = await subsCollection.where('provider', '==', 'twitch').get();
    for (const doc of existingDocs.docs) {
      if (!desiredDocIds.has(doc.id)) {
        try {
          await doc.ref.delete();
        } catch (err) {
          console.warn('[TwitchInit] Failed to remove outdated Twitch subscription doc', doc.id, err);
        }
      }
    }
  }

  // Handle Twitch webhook events
  async handleWebhook(event) {
    try {
      // Check if this is localhost (for testing)
      const isLocalhost = process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local';
      
      // Verify webhook signature
      const signature = event.headers['twitch-eventsub-message-signature'] || event.headers['Twitch-Eventsub-Message-Signature'];
      const messageId = event.headers['twitch-eventsub-message-id'] || event.headers['Twitch-Eventsub-Message-Id'];
      const messageTimestamp = event.headers['twitch-eventsub-message-timestamp'] || event.headers['Twitch-Eventsub-Message-Timestamp'];
      const messageType = event.headers['twitch-eventsub-message-type'] || event.headers['Twitch-Eventsub-Message-Type'];

      // On localhost, allow test events without signature verification
      if (isLocalhost && event.headers['x-test-event'] === 'true') {
        try {
          console.log('[LOCALHOST TEST MODE] Bypassing signature verification for test event');
          console.log('[TEST] Event body type:', typeof event.body);
          console.log('[TEST] Event body:', event.body?.substring(0, 200));
          
          // Use provided headers or generate defaults for test events
          const testMessageId = messageId || `test-${Date.now()}`;
          const testMessageTimestamp = messageTimestamp || new Date().toISOString();
          const testMessageType = messageType || 'notification';
          
          // Continue with test event processing
          let notification;
          try {
            // Handle both string and already-parsed body
            if (typeof event.body === 'string') {
              notification = JSON.parse(event.body);
            } else {
              notification = event.body;
            }
            console.log('[TEST] Parsed notification:', JSON.stringify(notification, null, 2));
          } catch (err) {
            console.error('[TEST] Error parsing notification:', err);
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'Invalid JSON in event body', details: err.message })
            };
          }
          
          const eventData = notification.event;
          const subscription = notification.subscription || {
            type: 'channel.cheer',
            condition: { broadcaster_user_id: eventData.broadcaster_user_id }
          };
          
          console.log('[TEST] Event data:', JSON.stringify(eventData, null, 2));
          console.log('[TEST] Subscription:', JSON.stringify(subscription, null, 2));

          const firebaseInitializer = require('./firebaseInit');
          await firebaseInitializer.initialize();
          const admin = require('firebase-admin');
          const db = admin.firestore();

          const broadcasterId = eventData.broadcaster_user_id || subscription.condition.broadcaster_user_id;
          
          if (!broadcasterId) {
            console.error('No broadcaster ID found in test event data');
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'Missing broadcaster ID' })
            };
          }

          const userId = `twitch:${broadcasterId}`;
          const subscriptionKey = `twitch_${subscription.type}`;
          
          console.log(`[TEST] Processing cheer event for broadcaster: ${userId}`);
          
          // Process the event (same logic as below)
          if (subscription.type === 'channel.cheer') {
            console.log(`[TEST] Processing channel.cheer event`);
            
            // Handle bits redemption for credits (same logic as production)
            const bitsAmount = eventData.bits || 0;
            const userWhoCheeredId = eventData.user_id || null;
            const userWhoCheeredName = eventData.user_name || eventData.user_login || 'Anonymous';
            
            console.log(`[TEST] Cheer event details:`, {
              bitsAmount,
              userWhoCheeredId,
              userWhoCheeredName,
              broadcasterId: userId
            });
            
            const userDoc = await db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
              console.log(`[TEST] ⚠️  Broadcaster user document not found: ${userId}`);
              console.log(`[TEST]   The broadcaster must have an account on the platform first.`);
              return {
                statusCode: 200,
                body: JSON.stringify({ 
                  received: true, 
                  test: true,
                  message: 'Test event processed successfully',
                  warning: `Broadcaster user document not found: ${userId}. The broadcaster must have an account first.`
                })
              };
            }
            
            console.log(`[TEST] Broadcaster user document exists`);
            
            const userData = userDoc.data();
            const userPageConfig = userData.userPageConfig || {};
            // Default to 100 if not configured
            const bitsToPointsAmount = userPageConfig.bitsToPointsAmount || 100;
            
            console.log(`[TEST] Broadcaster config:`, {
              bitsToPointsAmount,
              hasUserPageConfig: !!userData.userPageConfig,
              configuredValue: userPageConfig.bitsToPointsAmount
            });
            
            if (bitsAmount < bitsToPointsAmount) {
              console.log(`[TEST] ⚠️  Bits amount (${bitsAmount}) is less than bitsToPointsAmount (${bitsToPointsAmount})`);
              return {
                statusCode: 200,
                body: JSON.stringify({ 
                  received: true, 
                  test: true,
                  message: 'Test event processed successfully',
                  warning: `Bits amount (${bitsAmount}) is less than configured minimum (${bitsToPointsAmount}).`
                })
              };
            }
            
            console.log(`[TEST] Bits amount check passed: ${bitsAmount} >= ${bitsToPointsAmount}`);
            console.log(`[TEST] Entering donation creation block...`);
            
            if (bitsToPointsAmount > 0 && bitsAmount >= bitsToPointsAmount) {
                console.log(`[TEST] Inside donation creation block`);
                const creditsAmount = bitsAmount / 100;
                console.log(`[TEST] Credits amount: ${creditsAmount}`);
                
                let viewerId = null;
                if (userWhoCheeredId) {
                  console.log(`[TEST] userWhoCheeredId exists: ${userWhoCheeredId}`);
                  const viewerTwitchId = `twitch:${userWhoCheeredId}`;
                  console.log(`[TEST] Checking viewer document: ${viewerTwitchId}`);
                  
                  const viewerDoc = await db.collection('users').doc(viewerTwitchId).get();
                  
                  if (!viewerDoc.exists) {
                    console.log(`[TEST] Viewer document does not exist, creating...`);
                    try {
                      await db.collection('users').doc(viewerTwitchId).set({
                        twitchId: userWhoCheeredId,
                        twitchUsername: userWhoCheeredName.toLowerCase(),
                        displayName: userWhoCheeredName,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                      }, { merge: true });
                      console.log(`[TEST] ✅ Created pending user document for Twitch user ${userWhoCheeredId}`);
                    } catch (err) {
                      console.error(`[TEST] ❌ Error creating pending user document:`, err);
                      throw err; // Re-throw to see the error
                    }
                  } else {
                    console.log(`[TEST] Viewer document already exists`);
                  }
                  
                  viewerId = viewerTwitchId;
                  console.log(`[TEST] viewerId set to: ${viewerId}`);
                } else {
                  console.log(`[TEST] ⚠️  userWhoCheeredId is null or undefined`);
                }
                
                if (viewerId) {
                  console.log(`[TEST] Creating donation record...`);
                  const donationData = {
                    userId: userId,
                    viewerId: viewerId,
                    amount: creditsAmount,
                    bitsAmount: bitsAmount,
                    currency: 'usd',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    processed: true,
                    source: 'bits_redemption',
                    test: true // Mark as test event
                  };
                  
                  console.log(`[TEST] Donation data:`, donationData);
                  
                  try {
                    const donationRef = await db.collection('donations').add(donationData);
                    console.log(`[TEST] ✅ Bits redemption credited: ${userWhoCheeredName} (${viewerId}) received ${creditsAmount} credits for ${bitsAmount} bits`);
                    console.log(`[TEST] ✅ Donation record created in Firestore with ID: ${donationRef.id}`);
                    
                    return {
                      statusCode: 200,
                      body: JSON.stringify({ 
                        received: true, 
                        test: true,
                        message: 'Test event processed successfully',
                        donationCreated: true,
                        donationId: donationRef.id,
                        donationData: {
                          viewerId,
                          creditsAmount,
                          bitsAmount
                        }
                      })
                    };
                  } catch (err) {
                    console.error(`[TEST] ❌ Error creating donation record:`, err);
                    throw err; // Re-throw to see the error
                  }
                } else {
                  console.log(`[TEST] ⚠️  No viewerId available, skipping donation creation`);
                  console.log(`[TEST]   userWhoCheeredId was: ${userWhoCheeredId}`);
                }
              } else {
                console.log(`[TEST] ⚠️  Not entering donation creation block`);
                console.log(`[TEST]   bitsToPointsAmount: ${bitsToPointsAmount}`);
                console.log(`[TEST]   bitsAmount: ${bitsAmount}`);
                console.log(`[TEST]   Condition check: bitsToPointsAmount > 0 && bitsAmount >= bitsToPointsAmount`);
              }
          } else {
            console.log(`[TEST] ⚠️  Subscription type is not channel.cheer: ${subscription.type}`);
          }

          return {
            statusCode: 200,
            body: JSON.stringify({ 
              received: true, 
              test: true,
              message: 'Test event processed successfully',
              warning: 'Donation was not created - check logs for details'
            })
          };
        } catch (error) {
          console.error('[TEST] ❌ Error processing test event:', error);
          console.error('[TEST] Error stack:', error.stack);
          return {
            statusCode: 500,
            body: JSON.stringify({ 
              received: true, 
              test: true,
              error: 'Error processing test event',
              message: error.message,
              stack: error.stack
            })
          };
        }
      }

      if (!signature || !messageId || !messageTimestamp || !messageType) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing required headers' })
        };
      }

      // Handle webhook verification
      if (messageType === 'webhook_callback_verification') {
        const body = JSON.parse(event.body);
        const challenge = body.challenge;
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': challenge.length.toString()
          },
          body: challenge
        };
      }

      // Handle notification events
      if (messageType === 'notification') {
        const notification = JSON.parse(event.body);
        const eventData = notification.event;
        const subscription = notification.subscription;

        console.log(`[TwitchWebhook] Processing notification event:`, {
          subscriptionType: subscription.type,
          subscriptionId: subscription.id,
          eventDataKeys: Object.keys(eventData || {}),
          broadcasterId: eventData.broadcaster_user_id || subscription.condition.broadcaster_user_id,
          fullEventData: JSON.stringify(eventData, null, 2).substring(0, 500)
        });

        const firebaseInitializer = require('./firebaseInit');
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Find the user who owns this subscription by getting the broadcaster ID
        // from the event data
        const broadcasterId = eventData.broadcaster_user_id || subscription.condition.broadcaster_user_id;
        
        if (!broadcasterId) {
          console.error('[TwitchWebhook] No broadcaster ID found in event data:', {
            eventDataKeys: Object.keys(eventData || {}),
            subscriptionCondition: subscription.condition
          });
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing broadcaster ID' })
          };
        }

        // Look up the user by their Twitch broadcaster ID using a reverse mapping
        // Store this mapping when subscriptions are created
        const userId = `twitch:${broadcasterId}`;
        
        // Check if subscription exists for this user
        const subscriptionKey = `twitch_${subscription.type}`;
        console.log(`[TwitchWebhook] Looking up subscription: ${userId}/subscriptions/${subscriptionKey}`);
        const subscriptionDoc = await db.collection('users').doc(userId).collection('subscriptions').doc(subscriptionKey).get();
        
        let subscriptionData = null;
        if (subscriptionDoc.exists) {
          subscriptionData = subscriptionDoc.data();
          console.log(`[TwitchWebhook] Subscription found:`, {
            isActive: subscriptionData.isActive,
            eventType: subscriptionData.eventType,
            provider: subscriptionData.provider
          });
        } else {
          console.warn(`[TwitchWebhook] Subscription document not found: ${userId}/subscriptions/${subscriptionKey}`);
        }

        if (subscriptionData) {
          // Only process if subscription is active
          if (subscriptionData.isActive) {
            
            // Handle chat message events specially - they need command matching
            if (subscription.type === 'channel.chat.message') {
              // Extract message text from chat message event
              const messageText = eventData.message?.text || '';
              const chatterName = eventData.chatter_user_name || eventData.chatter_user_login || 'Anonymous';
              const chatterId = eventData.chatter_user_id || null;
              
              console.log(`Processing chat message from ${chatterName}: "${messageText}"`);
              
              // Parse command format: !maskyai <trigger> or just <trigger> if bot is mentioned
              // Check if message starts with !maskyai or contains the bot name
              const botMentionPattern = /^!maskyai\s+(.+)$/i;
              const match = messageText.match(botMentionPattern);
              
              if (!match || !match[1]) {
                console.log(`Chat message does not match command format (!maskyai <trigger>): "${messageText}"`);
                return {
                  statusCode: 200,
                  body: JSON.stringify({ received: true, processed: false, reason: 'Not a command' })
                };
              }
              
              const commandTrigger = match[1].trim().toLowerCase();
              console.log(`Extracted command trigger: "${commandTrigger}"`);
              
              // Find active projects for this user with eventType 'channel.chat_command' and matching commandTrigger
              const projectsSnapshot = await db.collection('projects')
                .where('userId', '==', userId)
                .where('platform', '==', 'twitch')
                .where('eventType', '==', 'channel.chat_command')
                .where('isActive', '==', true)
                .get();
              
              if (projectsSnapshot.empty) {
                console.log(`No active chat command projects found for user ${userId}`);
                return {
                  statusCode: 200,
                  body: JSON.stringify({ received: true, processed: false, reason: 'No matching projects' })
                };
              }
              
              // Filter projects by matching commandTrigger
              const matchingProjects = projectsSnapshot.docs.filter(doc => {
                const projectData = doc.data();
                const projectTrigger = (projectData.commandTrigger || '').trim().toLowerCase();
                return projectTrigger === commandTrigger;
              });
              
              if (matchingProjects.length === 0) {
                console.log(`No projects found with commandTrigger "${commandTrigger}" for user ${userId}`);
                return {
                  statusCode: 200,
                  body: JSON.stringify({ received: true, processed: false, reason: 'No matching command trigger' })
                };
              }
              
              // Select a random matching project (or first one if only one)
              const selectedProject = matchingProjects[Math.floor(Math.random() * matchingProjects.length)];
              const projectId = selectedProject.id;
              const projectData = selectedProject.data();
              
              console.log(`Matched command "${commandTrigger}" to project ${projectId} (${projectData.projectName || 'unnamed'})`);
              
              // Save event to user's events collection
              // Use the same eventKey format as other events: twitch_${eventType}
              // This matches what the frontend listener expects
              const eventKey = `twitch_channel.chat_command`;
              
              // Add command field to eventData for frontend template replacement
              const enrichedEventData = {
                ...eventData,
                command: commandTrigger,
                user_name: chatterName,
                chatter_user_name: chatterName,
                message: {
                  text: messageText
                }
              };
              
              const alertData = {
                eventType: 'channel.chat_command',
                provider: 'twitch',
                eventData: enrichedEventData,
                commandTrigger: commandTrigger,
                messageText: messageText,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userName: chatterName,
                userId: chatterId,
                selectedProjectId: projectId,
                messageId: messageId // For deduplication
              };
              
              // Store in user's events collection
              await db.collection('users').doc(userId).collection('events').doc(eventKey).collection('alerts').add(alertData);
              
              console.log(`Chat command event saved: ${userId}/events/${eventKey} (project: ${projectId}, trigger: ${commandTrigger})`);
              
              return {
                statusCode: 200,
                body: JSON.stringify({ 
                  received: true, 
                  processed: true,
                  commandTrigger: commandTrigger,
                  projectId: projectId
                })
              };
            } else if (subscription.type === 'channel.cheer') {
              // Handle bits redemption for credits
              const bitsAmount = eventData.bits || 0;
              const userWhoCheeredId = eventData.user_id || null;
              const userWhoCheeredName = eventData.user_name || eventData.user_login || 'Anonymous';
              
              // Get user's bitsToPointsAmount setting
              const userDoc = await db.collection('users').doc(userId).get();
              if (userDoc.exists) {
                const userData = userDoc.data();
                const userPageConfig = userData.userPageConfig || {};
                // Default to 100 if not configured
                const bitsToPointsAmount = userPageConfig.bitsToPointsAmount || 100;
                
                // Only process if bitsToPointsAmount is set and bits amount matches
                if (bitsToPointsAmount > 0 && bitsAmount >= bitsToPointsAmount) {
                  // Calculate credits: bits/100
                  const creditsAmount = bitsAmount / 100;
                  
                  // Find or create viewer account
                  let viewerId = null;
                  if (userWhoCheeredId) {
                    const viewerTwitchId = `twitch:${userWhoCheeredId}`;
                    const viewerDoc = await db.collection('users').doc(viewerTwitchId).get();
                    
                    if (!viewerDoc.exists) {
                      // User doesn't have an account yet - create a minimal user document
                      // This will allow credits to be stored and available when they connect/login
                      try {
                        await db.collection('users').doc(viewerTwitchId).set({
                          twitchId: userWhoCheeredId,
                          twitchUsername: userWhoCheeredName.toLowerCase(),
                          displayName: userWhoCheeredName,
                          updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        console.log(`Created pending user document for Twitch user ${userWhoCheeredId}`);
                      } catch (err) {
                        console.error('Error creating pending user document:', err);
                      }
                    }
                    
                    viewerId = viewerTwitchId;
                  }
                  
                  // Create donation record (credits will be available when user connects/login)
                  if (viewerId) {
                    const donationData = {
                      userId: userId,
                      viewerId: viewerId,
                      amount: creditsAmount,
                      bitsAmount: bitsAmount,
                      currency: 'usd',
                      timestamp: admin.firestore.FieldValue.serverTimestamp(),
                      createdAt: admin.firestore.FieldValue.serverTimestamp(),
                      processed: true,
                      source: 'bits_redemption'
                    };
                    
                    await db.collection('donations').add(donationData);
                    console.log(`Bits redemption credited: ${userWhoCheeredName} (${viewerId}) received ${creditsAmount} credits for ${bitsAmount} bits`);
                    
                    // Send chat message notification
                    try {
                      // Get broadcaster's Twitch access token from custom claims
                      const userRecord = await admin.auth().getUser(userId);
                      const claims = userRecord.customClaims || {};
                      const twitchAccessToken = claims.twitchAccessToken;
                      const twitchId = claims.twitchId;
                      
                      if (twitchAccessToken && twitchId) {
                        // Get broadcaster's Twitch username for the URL
                        const broadcasterTwitchUsername = userData.twitchUsername || null;
                        
                        // Build the message
                        let chatMessage = `Thank you for the donation of ${bitsAmount} bits, we have given you ${creditsAmount} credits`;
                        if (broadcasterTwitchUsername) {
                          chatMessage += ` on masky.ai/${broadcasterTwitchUsername} to use on redemptions.`;
                        } else {
                          chatMessage += ` on masky.ai to use on redemptions.`;
                        }
                        
                        // Send message to Twitch chat
                        await this.sendChatMessage(twitchId, twitchAccessToken, chatMessage);
                        console.log('Sent bits donation notification to Twitch chat:', chatMessage);
                      } else {
                        console.warn('Cannot send Twitch chat message: broadcaster Twitch token not found');
                      }
                    } catch (chatError) {
                      // Don't fail the bits processing if chat message fails
                      console.error('Error sending Twitch chat message for bits donation:', chatError);
                    }
                  }
                }
              }
            }
            
            // Continue with normal event processing (for projects/alerts)
            // This runs for all event types except channel.chat.message (which returns early)
            console.log(`[TwitchWebhook] Looking for active projects for event type: ${subscription.type}`);
            const projectsSnapshot = await db.collection('projects')
              .where('userId', '==', userId)
              .where('platform', '==', 'twitch')
              .where('eventType', '==', subscription.type)
              .where('isActive', '==', true)
              .get();

            console.log(`[TwitchWebhook] Found ${projectsSnapshot.size} active projects for event type ${subscription.type}`);

            if (!projectsSnapshot.empty) {
              // Select a random active project for reference
              const activeProjects = projectsSnapshot.docs;
              const randomIndex = Math.floor(Math.random() * activeProjects.length);
              const selectedProject = activeProjects[randomIndex];
              const projectId = selectedProject.id;

              // Save event to user's events collection (provider + eventType specific)
              const eventKey = `twitch_${subscription.type}`;
              const alertData = {
                eventType: subscription.type,
                provider: 'twitch',
                eventData: eventData,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userName: eventData.user_name || eventData.from_broadcaster_user_name || 'Anonymous',
                userId: eventData.user_id || eventData.from_broadcaster_user_id || null,
                selectedProjectId: projectId, // For reference, but not the primary storage
                messageId: messageId // For deduplication
              };

              // Store in user's events collection
              await db.collection('users').doc(userId).collection('events').doc(eventKey).collection('alerts').add(alertData);

              console.log(`[TwitchWebhook] ✅ Event saved to user events: ${userId}/events/${eventKey} (selected project: ${projectId} from ${activeProjects.length} active projects), Event: ${subscription.type}`);
            } else {
              console.warn(`[TwitchWebhook] ⚠️ No active projects found for user ${userId} and event type ${subscription.type}. Event will not be saved to Firestore.`);
              console.log(`[TwitchWebhook] To debug: Check if user has projects with eventType="${subscription.type}" and isActive=true`);
            }
          } else {
            console.log(`Subscription ${subscription.id} is inactive, skipping alert processing`);
          }
        } else {
          console.log(`No subscription found for Twitch subscription ID: ${subscription.id}`);
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true })
      };

    } catch (error) {
      console.error('Error handling Twitch webhook:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Webhook handler failed',
          message: error.message 
        })
      };
    }
  }

  // Exchange authorization code for access token and create Firebase user
  async handleOAuthCallback(event) {
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
      const { code, redirectUri } = body;

      if (!code) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing authorization code' })
        };
      }

      // Initialize Twitch credentials
      const { clientId, clientSecret } = await this.initialize();

      // Exchange code for access token
      const tokenUrl = 'https://id.twitch.tv/oauth2/token';
      // Use provided redirectUri or default to production
      // Note: redirectUri should be provided by the caller based on the request origin
      const finalRedirectUri = redirectUri || 'https://masky.ai/api/twitch_oauth';
      
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: finalRedirectUri
      });

      const url = require('url');
      
      console.log('Exchanging authorization code for token:', {
        redirectUri: redirectUri || 'https://masky.ai/api/twitch_oauth',
        codeLength: code?.length || 0,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret
      });
      
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
                reject(new Error(`Failed to parse token response: ${e.message}`));
              }
            } else {
              let errorMessage = `Token exchange failed (status ${res.statusCode})`;
              try {
                const errorData = JSON.parse(data);
                errorMessage += `: ${errorData.message || errorData.error || data}`;
                if (errorData.error_description) {
                  errorMessage += ` - ${errorData.error_description}`;
                }
              } catch (e) {
                errorMessage += `: ${data}`;
              }
              const error = new Error(errorMessage);
              error.statusCode = res.statusCode;
              error.responseBody = data;
              reject(error);
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
      const twitchUser = await this.verifyToken(accessToken);
      const uid = `twitch:${twitchUser.id}`;

      // Initialize Firebase Admin
      const firebaseInitializer = require('./firebaseInit');
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

      // Check if this is the bot account and store tokens separately
      const botUserId = '1386063343'; // From config
      const isBotAccount = twitchUser.id === botUserId;
      
      if (isBotAccount) {
        // Store bot account tokens in Firestore for later use
        const db = admin.firestore();
        const botTokensRef = db.collection('system').doc('bot_tokens');
        
        // Validate token scopes to ensure it has required scopes
        let validation;
        try {
          validation = await this.validateToken(accessToken);
        } catch (e) {
          console.warn('Could not validate bot token scopes:', e.message);
        }
        
        // Normalize scopes to array - tokenResponse.scope might be a string or array
        let scopes = [];
        if (validation?.scopes) {
          scopes = Array.isArray(validation.scopes) ? validation.scopes : 
                   (typeof validation.scopes === 'string' ? validation.scopes.split(' ').filter(Boolean) : []);
        } else if (tokenResponse.scope) {
          scopes = Array.isArray(tokenResponse.scope) ? tokenResponse.scope : 
                   (typeof tokenResponse.scope === 'string' ? tokenResponse.scope.split(' ').filter(Boolean) : []);
        }
        
        const botTokenData = {
          twitchId: twitchUser.id,
          accessToken: accessToken,
          refreshToken: tokenResponse.refresh_token || null,
          expiresAt: tokenResponse.expires_in ? 
            admin.firestore.Timestamp.fromMillis(Date.now() + (tokenResponse.expires_in * 1000)) : 
            null,
          scopes: scopes, // Store as array
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          displayName: twitchUser.display_name
        };
        
        await botTokensRef.set(botTokenData, { merge: true });
        console.log('Bot account tokens stored:', {
          twitchId: twitchUser.id,
          scopes: scopes,
          hasUserReadChat: scopes.includes('user:read:chat'),
          hasRequiredScopes: scopes.includes('user:read:chat') // Only user:read:chat is required
        });
      }

      await this.storeAdminSession(admin, {
        uid,
        twitchUser,
        accessToken,
        refreshToken: tokenResponse.refresh_token || null,
        expiresIn: tokenResponse.expires_in || null,
        scope: tokenResponse.scope || [],
        context: 'login'
      });

      const existingClaims = userRecord.customClaims || {};
      // Store Twitch access token in custom claims
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
        profileImage: twitchUser.profile_image_url,
        twitchAccessToken: accessToken
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
      console.error('Twitch OAuth callback error:', error);
      console.error('Error stack:', error.stack);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
        statusCode: error.statusCode
      });
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Internal server error',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          errorCode: error.code || error.statusCode || error.status
        })
      };
    }
  }
}

module.exports = new TwitchInitializer();