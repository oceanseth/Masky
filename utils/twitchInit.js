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
}

module.exports = new TwitchInitializer();