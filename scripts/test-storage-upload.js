/**
 * Test Firebase Storage rules by attempting an authenticated upload using the
 * same service account/SSM configuration as production.
 *
 * Usage:
 *   node scripts/test-storage-upload.js twitch:1386063343
 */

const admin = require('firebase-admin');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { KMSClient, DecryptCommand } = require('@aws-sdk/client-kms');

const REGION = process.env.AWS_REGION || 'us-east-1';
const STAGE = process.env.STAGE || 'production';
const PARAM_NAME = `/masky/${STAGE}/firebase_service_account`;
const API_KEY = 'AIzaSyBxDknJ0YcbfGXcrj9aoqyW5UMQm4OhcdI';
const BUCKET = 'maskydotnet.firebasestorage.app';

function sanitize(uid = '') {
  return uid.replace(/[:/.]/g, '_');
}

async function fetchServiceAccountJson() {
  const ssmClient = new SSMClient({ region: REGION });
  const kmsClient = new KMSClient({ region: REGION });

  const param = await ssmClient.send(new GetParameterCommand({
    Name: PARAM_NAME,
    WithDecryption: true
  }));

  let secretBuffer;
  if (param.Parameter.Value) {
    secretBuffer = Buffer.from(param.Parameter.Value, 'utf8');
  } else {
    throw new Error('Service account parameter has no value.');
  }

  if (param.Parameter.DataType === 'binary' || param.Parameter.ValueType === 'Binary') {
    const decrypted = await kmsClient.send(new DecryptCommand({ CiphertextBlob: secretBuffer }));
    secretBuffer = decrypted.Plaintext;
  }

  return JSON.parse(secretBuffer.toString('utf8'));
}

async function initializeAdmin() {
  if (admin.apps.length === 0) {
    const serviceAccount = await fetchServiceAccountJson();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: BUCKET
    });
  }
}

async function signInWithCustomToken(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Failed to sign in with custom token: ${resp.status} ${resp.statusText} - ${errorBody}`);
  }

  const data = await resp.json();
  return data.idToken;
}

async function testUpload(uid) {
  await initializeAdmin();

  console.log(`Creating custom token for UID: ${uid}`);
  const idToken = await signInWithCustomToken(uid);
  console.log(`Obtained ID token (length ${idToken.length})`);

  const sanitizedUid = sanitize(uid);
  const objectPath = `userData/${sanitizedUid}/videos/test_upload_${Date.now()}.mp4`;
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o?name=${encodeURIComponent(objectPath)}`;

  console.log(`Uploading sample file to ${objectPath}`);

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'video/mp4'
    },
    body: Buffer.from('test video content')
  });

  const bodyText = await resp.text();
  console.log('Response status:', resp.status, resp.statusText);
  console.log('Response body:', bodyText);

  if (!resp.ok) {
    throw new Error(`Upload failed with status ${resp.status}`);
  }

  console.log('Upload succeeded.');
}

const uid = process.argv[2] || 'twitch:1386063343';

testUpload(uid).catch(err => {
  console.error('Test upload failed:', err);
  process.exit(1);
});

