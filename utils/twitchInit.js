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
        adminUsers: fieldValue.arrayUnion('twitch:636906032', 'twitch:11867613'),
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
      // Verify webhook signature
      const signature = event.headers['twitch-eventsub-message-signature'] || event.headers['Twitch-Eventsub-Message-Signature'];
      const messageId = event.headers['twitch-eventsub-message-id'] || event.headers['Twitch-Eventsub-Message-Id'];
      const messageTimestamp = event.headers['twitch-eventsub-message-timestamp'] || event.headers['Twitch-Eventsub-Message-Timestamp'];
      const messageType = event.headers['twitch-eventsub-message-type'] || event.headers['Twitch-Eventsub-Message-Type'];

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

        const firebaseInitializer = require('./firebaseInit');
        await firebaseInitializer.initialize();
        const admin = require('firebase-admin');
        const db = admin.firestore();

        // Find the user who owns this subscription by getting the broadcaster ID
        // from the event data
        const broadcasterId = eventData.broadcaster_user_id || subscription.condition.broadcaster_user_id;
        
        if (!broadcasterId) {
          console.error('No broadcaster ID found in event data');
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
        const subscriptionDoc = await db.collection('users').doc(userId).collection('subscriptions').doc(subscriptionKey).get();
        
        let subscriptionData = null;
        if (subscriptionDoc.exists) {
          subscriptionData = subscriptionDoc.data();
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
            } else {
              // Handle other event types (follows, subscriptions, etc.)
              // Find all active projects for this user and event type
              const projectsSnapshot = await db.collection('projects')
                .where('userId', '==', userId)
                .where('platform', '==', 'twitch')
                .where('eventType', '==', subscription.type)
                .where('isActive', '==', true)
                .get();

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

                console.log(`Event saved to user events: ${userId}/events/${eventKey} (selected project: ${projectId} from ${activeProjects.length} active projects), Event: ${subscription.type}`);
              } else {
                console.log(`No active projects found for user ${userId} and event type ${subscription.type}`);
              }
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
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri || 'https://masky.ai/api/twitch_oauth'
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
        
        const botTokenData = {
          twitchId: twitchUser.id,
          accessToken: accessToken,
          refreshToken: tokenResponse.refresh_token || null,
          expiresAt: tokenResponse.expires_in ? 
            admin.firestore.Timestamp.fromMillis(Date.now() + (tokenResponse.expires_in * 1000)) : 
            null,
          scopes: validation?.scopes || tokenResponse.scope || [],
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          displayName: twitchUser.display_name
        };
        
        await botTokensRef.set(botTokenData, { merge: true });
        console.log('Bot account tokens stored:', {
          twitchId: twitchUser.id,
          hasRequiredScopes: validation?.scopes?.includes('user:read:chat') && validation?.scopes?.includes('user:bot')
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
  }
}

module.exports = new TwitchInitializer();