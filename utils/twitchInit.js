const AWS = require('aws-sdk');
const https = require('https');

AWS.config.update({ region: 'us-east-1' });

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

  // Load Twitch credentials from SSM
  async initialize() {
    try {
      // Return if already initialized
      if (this.clientId && this.clientSecret) {
        return { clientId: this.clientId, clientSecret: this.clientSecret };
      }

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

      return { clientId: this.clientId, clientSecret: this.clientSecret };
    } catch (error) {
      console.error('Failed to initialize Twitch credentials:', error);
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

      if (!tokenResponse.access_token) {
        throw new Error('No access token in response');
      }

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
      
      // Check if subscription already exists for this user and event type
      const subscriptionKey = `twitch_${type}`;
      const userSubscriptionsRef = db.collection('users').doc(userId).collection('subscriptions').doc(subscriptionKey);
      const existingSubscription = await userSubscriptionsRef.get();
      
      let subscription;
      
      if (existingSubscription.exists) {
        // Subscription already exists, return it
        const existingData = existingSubscription.data();
        subscription = existingData.twitchSubscription;
        console.log('Using existing subscription:', subscription.id);
      } else {
        // Initialize Twitch credentials from SSM
        const { clientId, clientSecret } = await this.initialize();
        
        // Always use app access token for EventSub creation
        const appAccessToken = await this.getAppAccessToken();
        console.log('App access token obtained:', appAccessToken ? 'SUCCESS' : 'FAILED');
        console.log('App access token length:', appAccessToken ? appAccessToken.length : 0);
        
        // For channel.follow events, we need to add moderator_user_id to the condition
        let requestBody = {
          type,
          version,
          condition,
          transport: {
            method: 'webhook',
            callback: 'https://masky.net/api/twitch-webhook',
            secret: clientSecret
          }
        };

        // For channel.follow events, add moderator_user_id (the user's Twitch ID)
        if (type === 'channel.follow') {
          requestBody.condition.moderator_user_id = customClaims.twitchId;
        }
        
        // Create EventSub subscription using app access token
        const twitchResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${appAccessToken}`,
            'Client-Id': clientId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!twitchResponse.ok) {
          const errorData = await twitchResponse.json();
          
          // Handle specific Twitch API errors
          if (errorData.message && errorData.message.includes('Client ID and OAuth token do not match')) {
            return {
              statusCode: 400,
              body: JSON.stringify({ 
                error: 'Twitch access token is invalid or expired. Please reconnect your Twitch account.',
                code: 'TWITCH_TOKEN_MISSING'
              })
            };
          }
          
          throw new Error(`Twitch API error: ${errorData.message || 'Unknown error'}`);
        }

        const subscriptionData = await twitchResponse.json();
        subscription = subscriptionData.data[0];
        
        // Save subscription to user's subscriptions collection
        await userSubscriptionsRef.set({
          provider: 'twitch',
          eventType: type,
          twitchSubscription: subscription,
          isActive: true, // Default to active
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('Created new subscription:', subscription.id);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ 
          subscription,
          message: existingSubscription.exists ? 'Using existing subscription' : 'EventSub subscription created successfully' 
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
        redirect_uri: redirectUri || 'https://masky.net/auth/callback'
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

      // Store Twitch access token in custom claims
      await admin.auth().setCustomUserClaims(uid, {
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