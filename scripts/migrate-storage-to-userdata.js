/**
 * Migration script to move storage objects from legacy top-level folders
 * into userData/{sanitizedUid}/{collection}/.
 *
 * Usage:
 *   1. npm install firebase-admin
 *   2. Export GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account key.
 *   3. node scripts/migrate-storage-to-userdata.js
 */

const admin = require('firebase-admin');

const COLLECTIONS = [
  { legacyPrefix: 'avatars/', collection: 'avatars' },
  { legacyPrefix: 'voices/', collection: 'voices' },
  { legacyPrefix: 'videos/', collection: 'videos' },
];

function sanitizeUid(uid = '') {
  return String(uid).replace(/[/:.]/g, '_');
}

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { KMSClient, DecryptCommand } = require('@aws-sdk/client-kms');

const REGION = process.env.AWS_REGION || 'us-east-1';
const STAGE = process.env.STAGE || 'production';
const PARAM_NAME = `/masky/${STAGE}/firebase_service_account`;

const ssmClient = new SSMClient({ region: REGION });
const kmsClient = new KMSClient({ region: REGION });

async function fetchServiceAccountJson() {
  console.log(`Fetching service account from SSM parameter ${PARAM_NAME} in ${REGION}`);
  const param = await ssmClient.send(new GetParameterCommand({
    Name: PARAM_NAME,
    WithDecryption: true
  }));

  let secretBuffer;
  if (param.Parameter.Type === 'SecureString' && param.Parameter.Value) {
    secretBuffer = Buffer.from(param.Parameter.Value, 'utf8');
  } else if (param.Parameter.Value) {
    secretBuffer = Buffer.from(param.Parameter.Value, 'utf8');
  } else {
    throw new Error('Service account parameter has no value.');
  }

  // If the parameter stores binary data, decrypt via KMS
  if (param.Parameter.DataType === 'binary' || param.Parameter.ValueType === 'Binary') {
    const decrypted = await kmsClient.send(new DecryptCommand({ CiphertextBlob: secretBuffer }));
    secretBuffer = decrypted.Plaintext;
  }

  try {
    return JSON.parse(secretBuffer.toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse service account JSON: ${err.message}`);
  }
}

async function initialize() {
  if (admin.apps.length === 0) {
    const serviceAccount = await fetchServiceAccountJson();

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: serviceAccount.storageBucket || 'maskydotnet.firebasestorage.app'
    });
  }
  return admin.storage().bucket();
}

async function migrateObject(bucket, legacyPrefix, collection, file) {
  const filepath = file.name;
  const filename = filepath.replace(legacyPrefix, '');

  const match = filename.match(/^(avatar|voice|video)_(.+?)_(\d+)\.(.+)$/);
  if (!match) {
    console.warn(`Skipping ${filepath}: could not parse file naming convention.`);
    return false;
  }

  const [, , rawUid, timestamp, extension] = match;
  const sanitizedUid = sanitizeUid(rawUid);
  const destPath = `userData/${sanitizedUid}/${collection}/${collection.slice(0, -1)}_${sanitizedUid}_${timestamp}.${extension}`;

  const destFile = bucket.file(destPath);
  const [exists] = await destFile.exists();
  if (exists) {
    console.log(`Destination ${destPath} already exists. Skipping copy for ${filepath}.`);
    await file.delete().catch((err) => console.warn(`Failed to delete legacy file ${filepath}: ${err.message}`));
    return true;
  }

  console.log(`Copying ${filepath} -> ${destPath}`);
  await file.copy(destFile);

  await file.delete().catch((err) => {
    console.warn(`Copied ${filepath} but failed to delete legacy source: ${err.message}`);
  });

  return true;
}

async function migrateCollection(bucket, { legacyPrefix, collection }) {
  console.log(`\nProcessing legacy folder: ${legacyPrefix}`);
  const [files] = await bucket.getFiles({ prefix: legacyPrefix });

  if (!files.length) {
    console.log(`No files found for prefix ${legacyPrefix}`);
    return;
  }

  let processed = 0;

  for (const file of files) {
    if (file.name.endsWith('/')) continue;
    try {
      const migrated = await migrateObject(bucket, legacyPrefix, collection, file);
      if (migrated) processed += 1;
    } catch (err) {
      console.error(`Failed to migrate ${file.name}: ${err.message}`, err);
    }
  }

  console.log(`Completed ${legacyPrefix}: migrated ${processed}/${files.length} objects\n`);
}

async function main() {
  const bucket = await initialize();
  for (const collection of COLLECTIONS) {
    await migrateCollection(bucket, collection);
  }
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

