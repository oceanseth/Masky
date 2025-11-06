/**
 * Script to check which avatar groups have avatar_group_id
 * Run with: node scripts/check-avatar-groups.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json'); // You'll need to download this from Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkAvatarGroups() {
  try {
    console.log('Checking all avatar groups for avatar_group_id...\n');
    
    const usersRef = db.collection('users');
    const usersSnapshot = await usersRef.get();
    
    let totalGroups = 0;
    let groupsWithId = 0;
    let groupsWithoutId = 0;
    const missingGroups = [];
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const groupsRef = userDoc.ref.collection('heygenAvatarGroups');
      const groupsSnapshot = await groupsRef.get();
      
      for (const groupDoc of groupsSnapshot.docs) {
        totalGroups++;
        const groupData = groupDoc.data();
        const hasAvatarGroupId = !!groupData.avatar_group_id;
        
        if (hasAvatarGroupId) {
          groupsWithId++;
          console.log(`✓ ${userId}/${groupDoc.id}: ${groupData.avatar_group_id} (${groupData.displayName || 'no name'})`);
        } else {
          groupsWithoutId++;
          missingGroups.push({
            userId,
            groupId: groupDoc.id,
            displayName: groupData.displayName || 'no name',
            createdAt: groupData.createdAt?.toDate?.() || groupData.createdAt
          });
          console.log(`✗ ${userId}/${groupDoc.id}: MISSING avatar_group_id (${groupData.displayName || 'no name'})`);
        }
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total avatar groups: ${totalGroups}`);
    console.log(`Groups WITH avatar_group_id: ${groupsWithId}`);
    console.log(`Groups WITHOUT avatar_group_id: ${groupsWithoutId}`);
    
    if (missingGroups.length > 0) {
      console.log('\n=== Groups Missing avatar_group_id ===');
      missingGroups.forEach(g => {
        console.log(`  - ${g.userId}/${g.groupId}: "${g.displayName}" (created: ${g.createdAt})`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAvatarGroups();

