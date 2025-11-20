/**
 * Migration script to migrate avatar assets from HeyGen URLs to Firebase Storage URLs
 * 
 * This script:
 * 1. Reads all avatar assets from Firestore (users/{userId}/heygenAvatarGroups/{groupId}/assets/{assetId})
 * 2. Identifies assets with HeyGen URLs (files*.heygen.ai)
 * 3. Fetches fresh image URLs from HeyGen API using avatar_group_id
 * 4. Downloads images from HeyGen
 * 5. Uploads to Firebase Storage
 * 6. Updates Firestore with new Firebase Storage URLs
 * 
 * Usage:
 *   node scripts/migrate-heygen-avatars-to-firebase-storage.js
 * 
 * Environment:
 *   - Requires AWS credentials configured (for SSM access)
 *   - Or set IS_OFFLINE=true and provide HEYGEN_API_KEY and FIREBASE_SERVICE_ACCOUNT in .env.local
 */

const admin = require('firebase-admin');
const https = require('https');
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-1' });
const firebaseInitializer = require('../utils/firebaseInit');

// Create a HeyGen client instance for this script
// We'll replicate the HeygenClient class functionality we need
class HeygenClient {
    constructor() {
        this.ssm = new AWS.SSM();
        this.apiKey = null;
    }

    async initialize() {
        if (this.apiKey) return this.apiKey;

        // Check if running locally
        if (process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local') {
            console.log('🔧 Running in local mode - loading HeyGen from environment');
            
            if (!process.env.HEYGEN_API_KEY) {
                throw new Error('HEYGEN_API_KEY not found in environment');
            }

            this.apiKey = process.env.HEYGEN_API_KEY;
            return this.apiKey;
        } else {
            // Production mode - load from SSM
            console.log('☁️  Loading HeyGen from SSM...');
            
            const stage = process.env.STAGE || 'production';
            const params = {
                Name: `/masky/${stage}/heygen_api_key`,
                WithDecryption: true
            };

            const result = await this.ssm.getParameter(params).promise();
            if (!result?.Parameter?.Value) {
                throw new Error('Heygen API key not found in SSM');
            }

            this.apiKey = result.Parameter.Value;
            return this.apiKey;
        }
    }

    async requestJson(path, options = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                const apiKey = await this.initialize();
                const url = `https://api.heygen.com${path}`;
                const payload = options.body ? JSON.stringify(options.body) : null;
                
                const req = https.request(url, {
                    method: options.method || 'GET',
                    headers: {
                        'X-Api-Key': apiKey,
                        'Accept': 'application/json',
                        ...(payload ? { 'Content-Type': 'application/json' } : {})
                    }
                }, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(body || '{}');
                            if (res.statusCode && res.statusCode >= 400) {
                                const errorMsg = json?.error?.message || json?.message || json?.error || `HeyGen request failed (${res.statusCode})`;
                                reject(new Error(errorMsg));
                                return;
                            }
                            resolve(json);
                        } catch (e) {
                            reject(new Error(`Invalid JSON from Heygen: ${body?.substring(0, 500)}`));
                        }
                    });
                });
                req.on('error', reject);
                if (payload) req.write(payload);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    async listLooksInPhotoAvatarGroup(groupId) {
        console.log(`[listLooksInPhotoAvatarGroup] Listing avatars for group: ${groupId}`);
        try {
            const path = `/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`;
            const json = await this.requestJson(path, { method: 'GET' });
            
            let avatars = [];
            
            if (json?.error) {
                console.error('[listLooksInPhotoAvatarGroup] HeyGen API error:', json.error);
                return [];
            }
            
            if (json?.data?.avatar_list && Array.isArray(json.data.avatar_list)) {
                avatars = json.data.avatar_list;
            } else if (Array.isArray(json?.data)) {
                avatars = json.data;
            } else if (Array.isArray(json?.avatars)) {
                avatars = json.avatars;
            } else if (Array.isArray(json?.avatar_list)) {
                avatars = json.avatar_list;
            }
            
            const looks = avatars.map(avatar => ({
                id: avatar.id,
                url: avatar.image_url,
                image_url: avatar.image_url,
                name: avatar.name,
                status: avatar.status,
                created_at: avatar.created_at,
                group_id: avatar.group_id
            }));
            
            return looks;
        } catch (err) {
            console.error('[listLooksInPhotoAvatarGroup] Failed:', err.message);
            return [];
        }
    }
}

const heygenClient = new HeygenClient();

function sanitizeStorageUid(uid = '') {
    return String(uid).replace(/[/:.]/g, '_');
}

function userStorageBasePath(uid = '') {
    return `userData/${sanitizeStorageUid(uid)}`;
}

/**
 * Download a file from a URL and return as Buffer
 */
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
                return;
            }
            
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    buffer,
                    contentType: res.headers['content-type'] || 'image/jpeg'
                });
            });
        }).on('error', reject);
    });
}

/**
 * Upload buffer to Firebase Storage
 */
async function uploadToFirebaseStorage(bucket, userId, buffer, contentType, originalFileName) {
    const sanitizedUid = sanitizeStorageUid(userId);
    const basePath = userStorageBasePath(userId);
    const timestamp = Date.now();
    
    // Extract extension from original filename or default to jpg
    const ext = originalFileName?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || 'jpg';
    const fileName = `avatar_${sanitizedUid}_${timestamp}.${ext}`;
    const objectPath = `${basePath}/avatars/${fileName}`;
    
    const file = bucket.file(objectPath);
    
    // Upload the buffer
    await file.save(buffer, {
        metadata: {
            contentType: contentType || 'image/jpeg',
            metadata: {
                userId: userId,
                originalFileName: originalFileName || fileName,
                uploadedAt: new Date().toISOString(),
                migrated: true,
                migratedAt: new Date().toISOString()
            }
        }
    });
    
    // Make file publicly accessible
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
    
    return publicUrl;
}

/**
 * Find matching HeyGen look URL for an asset
 * Returns the best matching URL, or null if none found
 */
async function findHeyGenLookUrl(heygenClient, avatarGroupId, assetUrl) {
    try {
        console.log(`  Fetching looks from HeyGen group: ${avatarGroupId}`);
        const looks = await heygenClient.listLooksInPhotoAvatarGroup(avatarGroupId);
        
        if (!looks || looks.length === 0) {
            console.warn(`  No looks found in HeyGen group ${avatarGroupId}`);
            return null;
        }
        
        // Extract filename/identifier from asset URL for matching
        const assetUrlParts = assetUrl.split('/');
        const assetFilename = assetUrlParts[assetUrlParts.length - 1]?.split('?')[0];
        
        // Try to find a matching look by URL or filename
        for (const look of looks) {
            const lookUrl = look.url || look.image_url;
            if (lookUrl) {
                // Try to match by filename or URL pattern
                const lookUrlParts = lookUrl.split('/');
                const lookFilename = lookUrlParts[lookUrlParts.length - 1]?.split('?')[0];
                
                // Match if filenames are similar or URLs share common patterns
                if (assetFilename && lookFilename && 
                    (assetFilename === lookFilename || 
                     assetFilename.includes(lookFilename) || 
                     lookFilename.includes(assetFilename))) {
                    console.log(`  Found matching look URL: ${lookUrl}`);
                    return lookUrl;
                }
            }
        }
        
        // If no match found, try the original URL first (it might still work)
        // If that fails, we'll fall back to the first available look
        console.log(`  No exact match found, will try original URL first`);
        
        // Return first available look URL as fallback
        const firstLookUrl = looks[0]?.url || looks[0]?.image_url;
        if (firstLookUrl) {
            console.log(`  Fallback: Using first available look URL: ${firstLookUrl}`);
            return firstLookUrl;
        }
        
        return null;
    } catch (err) {
        console.error(`  Error fetching looks from HeyGen: ${err.message}`);
        return null;
    }
}

/**
 * Migrate a single asset
 */
async function migrateAsset(db, bucket, heygenClient, userId, groupId, assetId, assetData) {
    const assetUrl = assetData.url;
    
    // Skip if already a Firebase Storage URL
    if (assetUrl && (assetUrl.includes('firebasestorage') || assetUrl.includes('storage.googleapis.com'))) {
        console.log(`  ✓ Asset ${assetId} already uses Firebase Storage: ${assetUrl}`);
        return { skipped: true, reason: 'already_firebase_storage' };
    }
    
    // Skip if not a HeyGen URL
    if (!assetUrl || !assetUrl.includes('heygen.ai')) {
        console.log(`  ⚠ Asset ${assetId} has non-HeyGen URL: ${assetUrl}`);
        return { skipped: true, reason: 'not_heygen_url' };
    }
    
    console.log(`  Processing asset ${assetId} with HeyGen URL: ${assetUrl}`);
    
    // Get the parent group to find avatar_group_id
    const groupRef = db.collection('users').doc(userId).collection('heygenAvatarGroups').doc(groupId);
    const groupDoc = await groupRef.get();
    
    if (!groupDoc.exists) {
        console.error(`  ✗ Group ${groupId} not found`);
        return { skipped: true, reason: 'group_not_found' };
    }
    
    const groupData = groupDoc.data();
    const avatarGroupId = groupData.avatar_group_id;
    
    if (!avatarGroupId) {
        console.warn(`  ⚠ Group ${groupId} has no avatar_group_id, skipping`);
        return { skipped: true, reason: 'no_avatar_group_id' };
    }
    
    // Try to get fresh URL from HeyGen, but also try original URL first
    const freshUrl = await findHeyGenLookUrl(heygenClient, avatarGroupId, assetUrl);
    
    // Try downloading from original URL first (it might still be valid)
    let downloadUrl = assetUrl;
    let downloadSuccess = false;
    
    if (freshUrl && freshUrl !== assetUrl) {
        // Try fresh URL first
        try {
            console.log(`  Attempting to download from fresh HeyGen URL: ${freshUrl}`);
            const { buffer, contentType } = await downloadFile(freshUrl);
            downloadUrl = freshUrl;
            downloadSuccess = true;
            
            // Upload to Firebase Storage
            console.log(`  Uploading to Firebase Storage...`);
            const newUrl = await uploadToFirebaseStorage(
                bucket,
                userId,
                buffer,
                contentType,
                assetData.fileName || 'avatar.jpg'
            );
            
            console.log(`  ✓ Uploaded to: ${newUrl}`);
            
            // Update Firestore
            const assetRef = db.collection('users').doc(userId)
                .collection('heygenAvatarGroups').doc(groupId)
                .collection('assets').doc(assetId);
            
            await assetRef.update({
                url: newUrl,
                migratedFrom: assetUrl,
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Also update group's avatarUrl if it matches the old URL
            if (groupData.avatarUrl === assetUrl) {
                await groupRef.update({
                    avatarUrl: newUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`  ✓ Updated group avatarUrl`);
            }
            
            return { success: true, oldUrl: assetUrl, newUrl };
        } catch (err) {
            console.log(`  Fresh URL failed: ${err.message}, trying original URL...`);
        }
    }
    
    // Try original URL as fallback
    if (!downloadSuccess) {
        try {
            console.log(`  Attempting to download from original URL: ${assetUrl}`);
            const { buffer, contentType } = await downloadFile(assetUrl);
            
            // Upload to Firebase Storage
            console.log(`  Uploading to Firebase Storage...`);
            const newUrl = await uploadToFirebaseStorage(
                bucket,
                userId,
                buffer,
                contentType,
                assetData.fileName || 'avatar.jpg'
            );
            
            console.log(`  ✓ Uploaded to: ${newUrl}`);
            
            // Update Firestore
            const assetRef = db.collection('users').doc(userId)
                .collection('heygenAvatarGroups').doc(groupId)
                .collection('assets').doc(assetId);
            
            await assetRef.update({
                url: newUrl,
                migratedFrom: assetUrl,
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Also update group's avatarUrl if it matches the old URL
            if (groupData.avatarUrl === assetUrl) {
                await groupRef.update({
                    avatarUrl: newUrl,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`  ✓ Updated group avatarUrl`);
            }
            
            return { success: true, oldUrl: assetUrl, newUrl };
        } catch (err) {
            console.error(`  ✗ Failed to download from both URLs: ${err.message}`);
            return { success: false, error: `Download failed: ${err.message}` };
        }
    }
    
    // This should never be reached, but just in case
    return { success: false, error: 'Unexpected state' };
}

/**
 * Main migration function
 */
async function migrateAllAssets() {
    console.log('🚀 Starting avatar asset migration from HeyGen to Firebase Storage\n');
    
    // Initialize Firebase
    console.log('Initializing Firebase...');
    await firebaseInitializer.initialize();
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    console.log(`✓ Firebase initialized with bucket: ${bucket.name}\n`);
    
    // Initialize HeyGen client
    console.log('Initializing HeyGen client...');
    const heygenClient = new HeygenClient();
    await heygenClient.initialize();
    console.log('✓ HeyGen client initialized\n');
    
    // Get all users
    console.log('Fetching all users...');
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();
    console.log(`Found ${usersSnapshot.size} users\n`);
    
    let totalAssets = 0;
    let migratedAssets = 0;
    let skippedAssets = 0;
    let failedAssets = 0;
    const results = {
        migrated: [],
        skipped: [],
        failed: []
    };
    
    // Process each user
    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        console.log(`\n📁 Processing user: ${userId}`);
        
        // Get avatar groups for this user
        const groupsRef = userDoc.ref.collection('heygenAvatarGroups');
        const groupsSnapshot = await groupsRef.get();
        
        if (groupsSnapshot.empty) {
            console.log(`  No avatar groups found`);
            continue;
        }
        
        console.log(`  Found ${groupsSnapshot.size} avatar group(s)`);
        
        // Process each group
        for (const groupDoc of groupsSnapshot.docs) {
            const groupId = groupDoc.id;
            const groupData = groupDoc.data();
            console.log(`\n  📦 Group: ${groupId} (${groupData.displayName || 'no name'})`);
            
            // Get assets for this group
            const assetsRef = groupDoc.ref.collection('assets');
            const assetsSnapshot = await assetsRef.get();
            
            if (assetsSnapshot.empty) {
                console.log(`    No assets found`);
                continue;
            }
            
            console.log(`    Found ${assetsSnapshot.size} asset(s)`);
            
            // Process each asset
            for (const assetDoc of assetsSnapshot.docs) {
                totalAssets++;
                const assetId = assetDoc.id;
                const assetData = assetDoc.data();
                
                const result = await migrateAsset(
                    db,
                    bucket,
                    heygenClient,
                    userId,
                    groupId,
                    assetId,
                    assetData
                );
                
                if (result.success) {
                    migratedAssets++;
                    results.migrated.push({
                        userId,
                        groupId,
                        assetId,
                        oldUrl: result.oldUrl,
                        newUrl: result.newUrl
                    });
                } else if (result.skipped) {
                    skippedAssets++;
                    results.skipped.push({
                        userId,
                        groupId,
                        assetId,
                        reason: result.reason
                    });
                } else {
                    failedAssets++;
                    results.failed.push({
                        userId,
                        groupId,
                        assetId,
                        error: result.error
                    });
                }
            }
        }
    }
    
    // Print summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total assets processed: ${totalAssets}`);
    console.log(`✓ Successfully migrated: ${migratedAssets}`);
    console.log(`⏭ Skipped: ${skippedAssets}`);
    console.log(`✗ Failed: ${failedAssets}`);
    console.log('='.repeat(60));
    
    if (results.migrated.length > 0) {
        console.log('\n✅ Migrated assets:');
        results.migrated.forEach(r => {
            console.log(`  - ${r.userId}/${r.groupId}/${r.assetId}`);
            console.log(`    Old: ${r.oldUrl}`);
            console.log(`    New: ${r.newUrl}`);
        });
    }
    
    if (results.failed.length > 0) {
        console.log('\n❌ Failed assets:');
        results.failed.forEach(r => {
            console.log(`  - ${r.userId}/${r.groupId}/${r.assetId}: ${r.error}`);
        });
    }
    
    console.log('\n✨ Migration complete!\n');
}

// Run migration
migrateAllAssets().catch((err) => {
    console.error('\n💥 Migration failed:', err);
    process.exit(1);
});

