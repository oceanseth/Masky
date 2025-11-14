#!/usr/bin/env node

/**
 * Publish Deployment Event to Firestore
 * 
 * This script publishes a deployment event to Firestore to notify
 * all active twitchevent.html overlays to reload after a deployment.
 * 
 * Usage:
 *   node scripts/publish-deployment-event.js [options]
 * 
 * Options (via environment variables or command line args):
 *   VERSION - Git commit SHA (default: current timestamp)
 *   BRANCH - Git branch name (default: 'unknown')
 *   COMMIT_MESSAGE - Commit message (default: 'Manual deployment')
 *   ACTOR - Who triggered the deployment (default: 'system')
 *   STAGE - Stage/environment (default: 'production')
 */

const AWS = require('aws-sdk');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Load local environment if .env.local exists
function loadLocalEnv() {
  const possiblePaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(__dirname, '..', '.env.local'),
  ];
  
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      console.log(`📁 Loading .env.local from: ${envPath}`);
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');

      lines.forEach(line => {
        if (!line || line.trim().startsWith('#') || line.trim() === '') {
          return;
        }

        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim();

        if (key && value) {
          process.env[key.trim()] = value;
        }
      });
      
      console.log('✅ Loaded local environment variables');
      return true;
    }
  }
  
  return false;
}

// Initialize Firebase Admin SDK
async function initializeFirebase() {
  // Check if already initialized
  if (admin.apps.length > 0) {
    return admin.app();
  }

  let serviceAccountJson;
  const hasLocalEnv = loadLocalEnv();
  const hasFirebaseInEnv = !!process.env.FIREBASE_SERVICE_ACCOUNT;
  const isLocal = process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local';
  
  // Use .env.local if it exists and has Firebase credentials, otherwise load from SSM
  if (hasLocalEnv && hasFirebaseInEnv && isLocal) {
    console.log('🔧 Running in local mode - loading Firebase from .env.local');

    // Decode base64 service account if needed
    const firebaseAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (firebaseAccount.startsWith('eyJ') || 
        /^[A-Za-z0-9+/=]+$/.test(firebaseAccount) && !firebaseAccount.startsWith('{')) {
      // Looks like base64 encoded
      serviceAccountJson = Buffer.from(firebaseAccount, 'base64').toString('utf8');
    } else {
      // Already JSON string
      serviceAccountJson = firebaseAccount;
    }
  } else if (hasLocalEnv && hasFirebaseInEnv) {
    // .env.local exists and has Firebase credentials, but not in local mode (e.g., CI/CD)
    console.log('🔧 Using Firebase from .env.local (CI/CD mode)');
    const firebaseAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (firebaseAccount.startsWith('eyJ') || 
        /^[A-Za-z0-9+/=]+$/.test(firebaseAccount) && !firebaseAccount.startsWith('{')) {
      serviceAccountJson = Buffer.from(firebaseAccount, 'base64').toString('utf8');
    } else {
      serviceAccountJson = firebaseAccount;
    }
  } else {
    console.log('☁️  Running in production mode - loading Firebase from SSM');
    
    // Configure AWS
    AWS.config.update({ region: process.env.AWS_REGION || 'us-east-1' });
    const ssm = new AWS.SSM();
    
    const stage = process.env.STAGE || 'production';
    const paramName = `/masky/${stage}/firebase_service_account`;
    
    try {
      const result = await ssm.getParameter({
        Name: paramName,
        WithDecryption: true
      }).promise();
      
      if (!result?.Parameter?.Value) {
        throw new Error(`Firebase service account not found in SSM at ${paramName}`);
      }
      
      serviceAccountJson = result.Parameter.Value;
    } catch (error) {
      console.error(`❌ Failed to load Firebase credentials from SSM: ${error.message}`);
      throw error;
    }
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  const projectId = serviceAccount.project_id;
  const resolvedDatabaseUrl = process.env.FIREBASE_DATABASE_URL
    || (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined)
    || 'https://maskydotnet-default-rtdb.firebaseio.com';

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: resolvedDatabaseUrl
  });

  console.log(`✅ Firebase initialized for project: ${projectId}`);
  return app;
}

// Publish deployment event to Firestore
async function publishDeploymentEvent() {
  try {
    // Initialize Firebase
    await initializeFirebase();
    const db = admin.firestore();
    
    // Get deployment metadata from environment variables or use defaults
    const deploymentData = {
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      version: process.env.VERSION || Date.now().toString(),
      branch: process.env.BRANCH || 'unknown',
      commitMessage: process.env.COMMIT_MESSAGE || 'Manual deployment',
      triggeredBy: process.env.ACTOR || 'system'
    };
    
    console.log('📤 Publishing deployment event to Firestore...');
    console.log('   Version:', deploymentData.version);
    console.log('   Branch:', deploymentData.branch);
    console.log('   Actor:', deploymentData.triggeredBy);
    
    // Write to _system/deployments/events collection
    const deploymentRef = db.collection('_system').doc('deployments').collection('events');
    const docRef = await deploymentRef.add(deploymentData);
    
    console.log(`✅ Deployment event published successfully!`);
    console.log(`   Document ID: ${docRef.id}`);
    console.log(`   Path: _system/deployments/events/${docRef.id}`);
    
    return docRef.id;
  } catch (error) {
    console.error('❌ Failed to publish deployment event:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  publishDeploymentEvent()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
}

module.exports = { publishDeploymentEvent, initializeFirebase };

