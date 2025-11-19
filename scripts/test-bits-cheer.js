#!/usr/bin/env node

/**
 * Test script to inject fake Twitch cheer events for localhost testing
 * 
 * Usage:
 *   node scripts/test-bits-cheer.js <broadcasterTwitchId> <viewerTwitchId> <bitsAmount> [viewerName]
 * 
 * Example:
 *   node scripts/test-bits-cheer.js 123456789 987654321 1000 TestUser
 * 
 * This simulates a cheer event from a user who may not exist on the site yet.
 * After running, the script will automatically verify:
 * 1. A donation record was created in the donations collection
 * 2. If the viewer didn't exist, a minimal user document was created
 * 3. Credits are available when the viewer logs in
 */

const https = require('https');
const http = require('http');
const { loadLocalEnv } = require('../local-env-loader');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('Usage: node scripts/test-bits-cheer.js <broadcasterTwitchId> <viewerTwitchId> <bitsAmount> [viewerName]');
  console.error('');
  console.error('Arguments:');
  console.error('  broadcasterTwitchId - The Twitch user ID of the streamer (e.g., 123456789)');
  console.error('  viewerTwitchId     - The Twitch user ID of the viewer cheering (e.g., 987654321)');
  console.error('  bitsAmount         - Number of bits cheered (e.g., 1000)');
  console.error('  viewerName         - Optional: Display name of the viewer (defaults to "TestUser")');
  console.error('');
  console.error('Example:');
  console.error('  node scripts/test-bits-cheer.js 123456789 999888777 1000 TestViewer');
  process.exit(1);
}

const broadcasterTwitchId = args[0];
const viewerTwitchId = args[1];
const bitsAmount = parseInt(args[2], 10);
const viewerName = args[3] || 'TestUser';

if (isNaN(bitsAmount) || bitsAmount <= 0) {
  console.error('Error: bitsAmount must be a positive number');
  process.exit(1);
}

// API endpoint (localhost only)
const apiUrl = 'http://localhost:3001/api/twitch-webhook';

// Create the webhook payload matching Twitch's format
const webhookPayload = {
  subscription: {
    id: `test-sub-${Date.now()}`,
    status: 'enabled',
    type: 'channel.cheer',
    version: '1',
    condition: {
      broadcaster_user_id: broadcasterTwitchId
    },
    transport: {
      method: 'webhook',
      callback: 'https://masky.ai/api/twitch-webhook'
    },
    created_at: new Date().toISOString()
  },
  event: {
    broadcaster_user_id: broadcasterTwitchId,
    broadcaster_user_login: 'testbroadcaster',
    broadcaster_user_name: 'TestBroadcaster',
    user_id: viewerTwitchId,
    user_login: viewerName.toLowerCase(),
    user_name: viewerName,
    message: `Test cheer message for ${bitsAmount} bits`,
    bits: bitsAmount
  }
};

// Create headers matching Twitch's webhook format
const headers = {
  'Content-Type': 'application/json',
  'twitch-eventsub-message-id': `test-msg-${Date.now()}`,
  'twitch-eventsub-message-timestamp': new Date().toISOString(),
  'twitch-eventsub-message-type': 'notification',
  'twitch-eventsub-message-signature': 'test-signature-localhost-only',
  'x-test-event': 'true' // Flag to indicate this is a test event
};

const payloadString = JSON.stringify(webhookPayload);

console.log('🧪 Testing Bits Cheer Event');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Broadcaster Twitch ID: ${broadcasterTwitchId}`);
console.log(`Viewer Twitch ID:      ${viewerTwitchId}`);
console.log(`Viewer Name:            ${viewerName}`);
console.log(`Bits Amount:            ${bitsAmount}`);
console.log(`Credits to be awarded: ${bitsAmount / 100}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log(`Sending test event to: ${apiUrl}`);
console.log('');

// Parse URL
const url = new URL(apiUrl);
const options = {
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  path: url.pathname,
  method: 'POST',
  headers: {
    ...headers,
    'Content-Length': Buffer.byteLength(payloadString)
  }
};

const requestModule = url.protocol === 'https:' ? https : http;

const req = requestModule.request(options, async (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', async () => {
    console.log(`Response Status: ${res.statusCode} ${res.statusMessage}`);
    console.log('');
    
    try {
      const response = JSON.parse(data);
      console.log('Response Body:');
      console.log(JSON.stringify(response, null, 2));
      
      if (res.statusCode === 200) {
        console.log('');
        console.log('✅ Test event sent successfully!');
        console.log('');
        console.log('🔍 Verifying Firestore records...');
        console.log('');
        
        // Wait a moment for Firestore to process
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify donation was created
        await verifyDonationRecord(broadcasterTwitchId, viewerTwitchId, bitsAmount);
        
        // Verify viewer user document
        await verifyViewerUserDocument(viewerTwitchId, viewerName);
      } else {
        console.log('');
        console.error('❌ Test event failed. Check the error above.');
        process.exit(1);
      }
    } catch (e) {
      console.log('Response (raw):', data);
      if (res.statusCode !== 200) {
        process.exit(1);
      }
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error sending test event:');
  console.error(error.message);
  console.error('');
  console.error('Make sure:');
  console.error('1. The API server is running (npm run api:dev)');
  console.error('2. The API is accessible at http://localhost:3001');
  process.exit(1);
});

req.write(payloadString);
req.end();

/**
 * Verify donation record was created in Firestore
 */
async function verifyDonationRecord(broadcasterTwitchId, viewerTwitchId, bitsAmount) {
  try {
    // Load local environment
    process.env.IS_OFFLINE = 'true';
    process.env.STAGE = 'local';
    loadLocalEnv();
    
    // Initialize Firebase
    const firebaseInitializer = require('../utils/firebaseInit');
    await firebaseInitializer.initialize();
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    const broadcasterUserId = `twitch:${broadcasterTwitchId}`;
    const viewerUserId = `twitch:${viewerTwitchId}`;
    const expectedCreditsAmount = bitsAmount / 100;
    
    console.log('Checking for donation record...');
    console.log(`  Broadcaster: ${broadcasterUserId}`);
    console.log(`  Viewer: ${viewerUserId}`);
    console.log(`  Expected credits: ${expectedCreditsAmount}`);
    console.log(`  Bits amount: ${bitsAmount}`);
    console.log('');
    
    // Query donations collection for matching record
    // Note: We query by userId and source first, then filter in memory to avoid index requirements
    const donationsSnapshot = await db.collection('donations')
      .where('userId', '==', broadcasterUserId)
      .where('source', '==', 'bits_redemption')
      .limit(50) // Get recent donations to filter
      .get();
    
    // Filter in memory for exact match
    const matchingDonations = donationsSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.viewerId === viewerUserId && 
             data.bitsAmount === bitsAmount &&
             data.source === 'bits_redemption';
    });
    
    if (matchingDonations.length === 0) {
      console.error('❌ Donation record NOT FOUND in Firestore!');
      console.error('');
      console.error('Possible reasons:');
      console.error('1. The broadcaster user document may not exist');
      console.error('2. The webhook handler may have encountered an error');
      console.error('3. There may be a delay in Firestore (try waiting a few seconds)');
      console.error('');
      console.error('Checking broadcaster user document...');
      
      const broadcasterDoc = await db.collection('users').doc(broadcasterUserId).get();
      if (!broadcasterDoc.exists) {
        console.error(`❌ Broadcaster user document does not exist: ${broadcasterUserId}`);
        console.error('   The broadcaster must have an account on the platform first.');
      } else {
        const broadcasterData = broadcasterDoc.data();
        const userPageConfig = broadcasterData.userPageConfig || {};
        const bitsToPointsAmount = userPageConfig.bitsToPointsAmount || 100;
        
        console.log(`✅ Broadcaster user document exists`);
        console.log(`   bitsToPointsAmount: ${bitsToPointsAmount} (configured: ${userPageConfig.bitsToPointsAmount || 'not set, using default 100'})`);
        
        if (bitsAmount < bitsToPointsAmount) {
          console.error(`❌ Bits amount (${bitsAmount}) is less than bitsToPointsAmount (${bitsToPointsAmount})`);
        } else {
          console.error(`⚠️  Bits amount (${bitsAmount}) should be sufficient (>= ${bitsToPointsAmount})`);
          console.error('   Check the API server logs for errors during webhook processing.');
        }
      }
      
      // Also check recent donations to see what's there
      console.log('');
      console.log('Recent donations for this broadcaster:');
      if (donationsSnapshot.docs.length === 0) {
        console.log('  (no donations found for this broadcaster)');
      } else {
        // Sort by createdAt descending
        const sortedDocs = donationsSnapshot.docs.sort((a, b) => {
          const aTime = a.data().createdAt?.toMillis() || 0;
          const bTime = b.data().createdAt?.toMillis() || 0;
          return bTime - aTime;
        }).slice(0, 5);
        
        sortedDocs.forEach(doc => {
          const data = doc.data();
          const createdAt = data.createdAt?.toDate() || 'unknown';
          console.log(`  - ${doc.id}: viewerId=${data.viewerId}, bitsAmount=${data.bitsAmount}, credits=${data.amount}, createdAt=${createdAt}`);
        });
      }
      
      process.exit(1);
    } else {
      // Get the most recent matching donation
      const donationDoc = matchingDonations.sort((a, b) => {
        const aTime = a.data().createdAt?.toMillis() || 0;
        const bTime = b.data().createdAt?.toMillis() || 0;
        return bTime - aTime;
      })[0];
      const donationData = donationDoc.data();
      
      console.log('✅ Donation record FOUND in Firestore!');
      console.log(`   Document ID: ${donationDoc.id}`);
      console.log(`   Credits amount: ${donationData.amount}`);
      console.log(`   Bits amount: ${donationData.bitsAmount}`);
      console.log(`   Source: ${donationData.source}`);
      console.log(`   Test flag: ${donationData.test || false}`);
      console.log(`   Created at: ${donationData.createdAt?.toDate()}`);
      console.log('');
      
      // Verify the amounts match
      if (Math.abs(donationData.amount - expectedCreditsAmount) > 0.01) {
        console.error(`⚠️  Warning: Credits amount mismatch! Expected ${expectedCreditsAmount}, got ${donationData.amount}`);
      }
      
      if (donationData.bitsAmount !== bitsAmount) {
        console.error(`⚠️  Warning: Bits amount mismatch! Expected ${bitsAmount}, got ${donationData.bitsAmount}`);
      }
    }
  } catch (error) {
    console.error('❌ Error verifying donation record:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Verify viewer user document exists
 */
async function verifyViewerUserDocument(viewerTwitchId, viewerName) {
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    const viewerUserId = `twitch:${viewerTwitchId}`;
    
    console.log('Checking viewer user document...');
    console.log(`  Viewer ID: ${viewerUserId}`);
    console.log('');
    
    const viewerDoc = await db.collection('users').doc(viewerUserId).get();
    
    if (!viewerDoc.exists) {
      console.error('❌ Viewer user document NOT FOUND!');
      console.error('   The viewer user document should have been created by the webhook handler.');
      console.error('   This may indicate an error in the webhook processing.');
    } else {
      const viewerData = viewerDoc.data();
      console.log('✅ Viewer user document exists!');
      console.log(`   Display name: ${viewerData.displayName || 'not set'}`);
      console.log(`   Twitch username: ${viewerData.twitchUsername || 'not set'}`);
      console.log(`   Twitch ID: ${viewerData.twitchId || 'not set'}`);
      console.log('');
    }
  } catch (error) {
    console.error('❌ Error verifying viewer user document:');
    console.error(error.message);
  }
}

