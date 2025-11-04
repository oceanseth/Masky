const AWS = require('aws-sdk');
const admin = require('firebase-admin');
AWS.config.update({ region: 'us-east-1' });

class FirebaseInitializer {
  constructor() {
    this.ssm = new AWS.SSM();
    this.firebaseApp = null;
  }

  async initialize() {
    try {
      // Return existing instance if already initialized
      if (this.firebaseApp) return this.firebaseApp;

      const params = {
        Name: '/masky/production/firebase_service_account',
        WithDecryption: true
      };

      const result = await this.ssm.getParameter(params).promise();
      
      if (!result?.Parameter?.Value) {
        throw new Error('Firebase service account credentials not found in SSM');
      }

      const serviceAccount = JSON.parse(result.Parameter.Value);

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