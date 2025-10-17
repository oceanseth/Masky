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

  // Get credentials
  getCredentials() {
    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret
    };
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
  }
}

module.exports = new TwitchInitializer();