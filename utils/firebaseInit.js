const AWS = require('aws-sdk');
const admin = require('firebase-admin');
AWS.config.update({ region: 'us-east-1' });

// Note: Local environment is loaded in api/api.js handler
// No need to load again here

class FirebaseInitializer {
  constructor() {
    this.ssm = new AWS.SSM();
    this.firebaseApp = null;
  }

  async initialize() {
    try {
      // Return existing instance if already initialized
      if (this.firebaseApp) return this.firebaseApp;

      let serviceAccountJson;

      // Check if running locally
      if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
        console.log('🔧 Running in local mode - loading Firebase from environment');
        
        if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
          throw new Error('FIREBASE_SERVICE_ACCOUNT not found in .env.local. Please copy env.local.example to .env.local and fill in your credentials.');
        }

        // Decode base64 service account
        serviceAccountJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
      } else {
        // Production mode - load from SSM
        console.log('☁️  Running in production mode - loading Firebase from SSM');
        
        const params = {
          Name: '/masky/production/firebase_service_account',
          WithDecryption: true
        };

        const result = await this.ssm.getParameter(params).promise();
        
        if (!result?.Parameter?.Value) {
          throw new Error('Firebase service account credentials not found in SSM');
        }

        serviceAccountJson = result.Parameter.Value;
      }

      const serviceAccount = JSON.parse(serviceAccountJson);

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://maskydotnet-default-rtdb.firebaseio.com',
        storageBucket: 'maskydotnet.appspot.com'
      });

      return this.firebaseApp;
    } catch (error) {
      console.error('Failed to initialize Firebase:', error);
      throw error;
    }
  }
}

module.exports = new FirebaseInitializer();